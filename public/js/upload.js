(async () => {
  const me = await initShell();
  const page = $('#page');
  if (!me) { page.innerHTML = '<div class="empty">강의를 업로드하려면 로그인이 필요합니다.</div>'; return; }
  const cats = await api('/api/categories');
  const editId = new URLSearchParams(location.search).get('id');

  page.innerHTML = `
  <div class="drafts" id="drafts"></div>
  <div class="upload-grid">
    <div>
      <div class="preview" id="preview"><span>미리보기</span></div>
      <div class="dropzone" id="drop"><span class="name" id="fname">업로드 파일 (클릭하거나 끌어놓기)</span>
        <button type="button" class="btn-sm" id="pick">파일 선택</button>
        <button type="button" class="btn-sm" id="snap" disabled title="현재 장면을 썸네일로">🖼 썸네일</button>
        <input type="file" id="file" accept="video/*" hidden></div>
      <div class="progress" id="prog"><i></i></div>
    </div>
    <div>
      <div class="field"><label>제목</label><input class="input" id="title" maxlength="100" placeholder="제목"></div>
      <div class="field"><label>설명</label><textarea class="input" id="desc" maxlength="5000" placeholder="설명" style="min-height:110px"></textarea></div>
      <div class="panel"><h3>시리즈 / 폴더분류 / 연속강의등록설정</h3>
        <div class="row"><div class="field"><label>과목</label><select class="input" id="cat"></select></div>
          <div class="field"><label>세부 분류 (폴더)</label><select class="input" id="sub"></select></div></div>
        <div class="row3" style="grid-template-columns:1fr 90px"><div class="field" style="margin:0"><label>시리즈 이름 (같은 이름끼리 연속강의로 묶임)</label><input class="input" id="series" maxlength="60" list="seriesList" placeholder="예: 수학Ⅰ 지수와 로그"></div>
          <div class="field" style="margin:0"><label>회차</label><input class="input" id="order" type="number" min="1" value="1"></div></div>
        <datalist id="seriesList"></datalist></div>
    </div>
  </div>
  <div class="panel sub-editor"><h3>자막 편집기</h3>
    <div class="cue-tools">
      <button type="button" class="btn-sm" id="addCue">+ 현재 위치에 자막 추가</button>
      <button type="button" class="btn-sm" id="impSub">SRT/VTT 불러오기</button>
      <input type="file" id="subFile" accept=".srt,.vtt,text/vtt" hidden>
      <span style="color:var(--muted);font-size:12px">시간은 <b>분:초.소수</b> 형식 (예: 1:23.5). ⏱ 버튼은 현재 재생 위치를 넣습니다.</span></div>
    <div class="cue-head"><span>시작</span><span>끝</span><span>내용</span><span></span></div>
    <div class="cue-list" id="cues"></div></div>
  <div class="actions"><button class="btn" id="draft">임시저장</button><button class="btn primary" id="publish">업로드</button></div>`;

  const catSel = $('#cat'), subSel = $('#sub');
  catSel.innerHTML = Object.keys(cats).map((c) => `<option>${esc(c)}</option>`).join('');
  const fillSub = (v) => { subSel.innerHTML = cats[catSel.value].map((s) => `<option>${esc(s)}</option>`).join(''); if (v) subSel.value = v; };
  catSel.onchange = () => fillSub();
  fillSub();

  // 내 시리즈 자동완성 / 임시저장 목록
  api('/api/lectures?scope=mine').then((l) => { $('#seriesList').innerHTML = [...new Set(l.map((x) => x.series).filter(Boolean))].map((s) => `<option value="${esc(s)}">`).join(''); });
  api('/api/drafts').then((d) => {
    const el = $('#drafts');
    if (d.length) el.innerHTML = '<b>임시저장된 강의:</b>' + d.map((x) => `<a href="/upload.html?id=${x.id}">${esc(x.title || '(제목 없음)')}</a>`).join('');
  });

  // ---- 동영상 선택 / 미리보기 / 썸네일 ----
  const vid = document.createElement('video');
  vid.controls = true;
  vid.preload = 'metadata';
  let videoFile = null, thumbBlob = null, cues = [];
  const setVideoSrc = (src) => { vid.src = src; $('#preview').replaceChildren(vid); $('#snap').disabled = false; };
  function snap() {
    if (!vid.videoWidth) return;
    const c = document.createElement('canvas');
    const w = Math.min(640, vid.videoWidth);
    c.width = w; c.height = Math.round((w * vid.videoHeight) / vid.videoWidth);
    c.getContext('2d').drawImage(vid, 0, 0, c.width, c.height);
    c.toBlob((b) => { thumbBlob = b; toast('현재 장면이 썸네일로 설정되었습니다.'); }, 'image/jpeg', 0.8);
  }
  $('#snap').onclick = snap;
  function chooseFile(f) {
    if (!f || !f.type.startsWith('video/')) return toast('동영상 파일을 선택해주세요.');
    videoFile = f;
    $('#fname').textContent = `${f.name} (${(f.size / 1048576).toFixed(1)}MB)`;
    thumbBlob = null;
    if (!$('#title').value) $('#title').value = f.name.replace(/\.[^.]+$/, '');
    vid.addEventListener('loadeddata', () => { vid.currentTime = Math.min(1, (vid.duration || 2) / 10); }, { once: true });
    vid.addEventListener('seeked', () => { if (!thumbBlob) snap(); }, { once: true });
    setVideoSrc(URL.createObjectURL(f));
  }
  $('#pick').onclick = () => $('#file').click();
  $('#file').onchange = (e) => chooseFile(e.target.files[0]);
  const drop = $('#drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('drag'); };
  drop.ondragleave = () => drop.classList.remove('drag');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('drag'); chooseFile(e.dataTransfer.files[0]); };

  // ---- 자막 편집기 ----
  const parseT = (v) => {
    v = String(v).trim().replace(',', '.');
    if (!v) return NaN;
    return v.split(':').reduce((a, p) => a * 60 + parseFloat(p), 0);
  };
  const fmtT = (t) => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`; };
  function renderCues() {
    $('#cues').innerHTML = cues.map((c, i) => `<div class="cue" data-i="${i}">
      <div style="display:flex;gap:2px"><input class="input s" value="${fmtT(c.start)}"><button type="button" class="btn-sm" data-set="start" title="현재 위치">⏱</button></div>
      <div style="display:flex;gap:2px"><input class="input e" value="${fmtT(c.end)}"><button type="button" class="btn-sm" data-set="end" title="현재 위치">⏱</button></div>
      <input class="input t" value="${esc(c.text)}" placeholder="자막 내용"><button type="button" class="cue-x" title="삭제">×</button></div>`).join('') || '<div style="color:var(--muted);font-size:13px;padding:8px">자막이 없습니다.</div>';
  }
  const list = $('#cues');
  list.addEventListener('input', (e) => {
    const row = e.target.closest('.cue'); if (!row) return;
    const c = cues[row.dataset.i];
    if (e.target.classList.contains('t')) c.text = e.target.value;
    else { const v = parseT(e.target.value); if (!isNaN(v)) c[e.target.classList.contains('s') ? 'start' : 'end'] = v; }
  });
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.cue'); if (!row) return;
    const c = cues[row.dataset.i];
    if (e.target.classList.contains('cue-x')) { cues.splice(row.dataset.i, 1); renderCues(); }
    else if (e.target.dataset.set) { c[e.target.dataset.set] = vid.currentTime || 0; renderCues(); }
  });
  $('#addCue').onclick = () => { const t = vid.currentTime || 0; cues.push({ start: t, end: t + 3, text: '' }); renderCues(); list.lastElementChild?.querySelector('.t')?.focus(); };
  vid.addEventListener('timeupdate', () => {
    list.querySelectorAll('.cue').forEach((r) => { const c = cues[r.dataset.i]; r.classList.toggle('active', vid.currentTime >= c.start && vid.currentTime < c.end); });
  });
  $('#impSub').onclick = () => $('#subFile').click();
  $('#subFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const txt = (await f.text()).replace(/\r/g, '').replace(/^﻿/, '');
    const out = [];
    for (const blk of txt.split(/\n\n+/)) {
      const lines = blk.split('\n');
      const ti = lines.findIndex((l) => l.includes('-->'));
      if (ti < 0) continue;
      const [a, b] = lines[ti].split('-->').map((x) => parseT(x.trim().split(/\s/)[0]));
      const text = lines.slice(ti + 1).join('\n').replace(/<[^>]+>/g, '').trim();
      if (text && b > a) out.push({ start: a, end: b, text });
    }
    cues = cues.concat(out); renderCues(); toast(`자막 ${out.length}개를 불러왔습니다.`); e.target.value = '';
  };
  renderCues();

  // ---- 임시저장 이어서 편집 ----
  let id = editId;
  if (editId) {
    try {
      const l = await api('/api/lectures/' + editId);
      if (!l.mine) throw new Error();
      $('#title').value = l.title; $('#desc').value = l.description;
      catSel.value = l.category; fillSub(l.sub);
      $('#series').value = l.series; $('#order').value = l.seriesOrder;
      cues = l.cues || []; renderCues();
      if (l.video) { setVideoSrc(l.video); $('#fname').textContent = '저장된 동영상 (새 파일을 선택하면 교체됩니다)'; }
      if (l.status === 'published') $('#draft').style.display = 'none';
    } catch { toast('강의를 불러올 수 없습니다.'); id = null; }
  }

  // ---- 저장 ----
  function save(status) {
    if (status === 'published') {
      if (!$('#title').value.trim()) return toast('제목을 입력해주세요.');
      if (!videoFile && !(id && vid.src)) return toast('업로드할 동영상 파일을 선택해주세요.');
    }
    const fd = new FormData();
    if (id) fd.append('id', id);
    fd.append('status', status);
    fd.append('title', $('#title').value);
    fd.append('description', $('#desc').value);
    fd.append('category', catSel.value);
    fd.append('sub', subSel.value);
    fd.append('series', $('#series').value);
    fd.append('seriesOrder', $('#order').value);
    fd.append('subtitles', JSON.stringify(cues));
    if (videoFile) fd.append('video', videoFile);
    if (thumbBlob) fd.append('thumb', thumbBlob, 'thumb.jpg');
    const btns = [$('#draft'), $('#publish')];
    btns.forEach((b) => (b.disabled = true));
    const prog = $('#prog'); prog.style.display = videoFile ? 'block' : 'none';
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/lectures');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) $('#prog i').style.width = (e.loaded / e.total) * 100 + '%'; };
    xhr.onload = () => {
      btns.forEach((b) => (b.disabled = false));
      let r = {}; try { r = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status !== 200) return toast(r.error || '저장에 실패했습니다.');
      if (status === 'published') location.href = '/watch.html?id=' + r.id;
      else { id = r.id; videoFile = null; history.replaceState(null, '', '/upload.html?id=' + id); toast('임시저장되었습니다.'); }
    };
    xhr.onerror = () => { btns.forEach((b) => (b.disabled = false)); toast('네트워크 오류가 발생했습니다.'); };
    xhr.send(fd);
  }
  $('#draft').onclick = () => save('draft');
  $('#publish').onclick = () => save('published');
})();
