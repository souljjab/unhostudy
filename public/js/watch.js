(async () => {
  const me = await initShell();
  const id = new URLSearchParams(location.search).get('id');
  const page = $('#page');
  let l;
  try { l = await api('/api/lectures/' + id); } catch (e) { page.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  document.title = `${l.title || '강의'} - 운호스터디`;

  page.innerHTML = `<div class="watch">
    <div class="player" id="player">
      <video id="v" preload="metadata" playsinline ${l.video ? `src="${esc(l.video)}"` : ''}>
        ${l.hasSubtitles ? `<track id="trk" kind="subtitles" srclang="ko" label="한국어" src="${esc(l.subtitleUrl)}" default>` : ''}
      </video>
      <button class="bigplay" id="big" aria-label="재생">▶</button>
      <div class="menu" id="menu">
        <h4>화질 설정</h4>
        <div class="opts"><button class="opt on">원본</button><button class="opt" disabled>1080p</button><button class="opt" disabled>720p</button><button class="opt" disabled>480p</button></div>
        <div class="hint">현재는 업로드된 원본 화질로만 재생됩니다.</div>
        <h4>자막 설정</h4>
        <div class="opts" id="subOnOff"><button class="opt" data-v="on">켜기</button><button class="opt" data-v="off">끄기</button></div>
        <div class="opts" id="subSize"><button class="opt" data-v="16">작게</button><button class="opt" data-v="22">보통</button><button class="opt" data-v="30">크게</button></div>
        ${l.hasSubtitles ? '' : '<div class="hint">이 강의에는 자막이 없습니다.</div>'}
      </div>
      <div class="controls" id="ctl">
        <button class="cbtn" id="back" title="10초 뒤로 (←)">⟲ 10초</button>
        <button class="cbtn" id="play" title="재생/일시정지 (Space)">▶</button>
        <button class="cbtn" id="fwd" title="10초 앞으로 (→)">10초 ⟳</button>
        <span class="time" id="cur">0:00</span>
        <input class="seek" id="seek" type="range" min="0" max="1000" value="0" step="1" aria-label="재생 위치">
        <span class="time" id="dur">0:00</span>
        <button class="cbtn" id="gear">⚙ 설정</button>
        <button class="cbtn" id="rate" title="재생 속도">배속 1x</button>
        <button class="cbtn" id="fs" title="전체화면 (F)">⛶</button>
      </div>
    </div>
    <div class="vtitle">${esc(l.title)}</div>
    <div class="vactions"><span style="color:var(--muted);font-size:13px">${esc(l.category)}${l.sub ? ' › ' + esc(l.sub) : ''} · ${fmtDate(l.createdAt)} · 조회 ${l.views}</span>
      <button class="btn-sm favbtn ${l.favorite ? 'on' : ''}" id="fav">${l.favorite ? '★ 즐겨찾기됨' : '☆ 즐겨찾기'}</button>
      ${l.mine ? '<a class="btn-sm" href="/upload.html?id=' + l.id + '">수정</a><button class="btn-sm" id="del" style="color:var(--danger)">삭제</button>' : ''}</div>
    <div class="under">
      <div class="panel"><h3>설명란</h3><div class="desc">${esc(l.description) || '<span style="color:var(--muted)">설명이 없습니다.</span>'}</div></div>
      <div class="panel author"><h3>업로드한 학생의 프로필</h3><div class="avatar">${esc(l.author.name.slice(0, 1))}</div><b>${esc(l.author.name)}</b>
        <div class="stat">업로드한 강의 ${l.author.lectures}개<br>누적 조회수 ${l.author.views}회</div></div>
      <div class="panel"><h3>이어지는 강좌${l.series ? ` <small style="color:var(--muted);font-weight:400">${esc(l.series)}</small>` : ''}</h3><div id="next"></div></div>
    </div></div>`;

  const v = $('#v'), pl = $('#player'), seek = $('#seek');
  const idx = l.seriesList.findIndex((x) => x.id === l.id);
  const nextLec = idx >= 0 ? l.seriesList[idx + 1] : null;
  $('#next').innerHTML = l.seriesList.length > 1
    ? l.seriesList.map((x) => `<a class="next-item ${x.id === l.id ? 'cur' : ''}" href="/watch.html?id=${x.id}"><div class="th" ${x.thumb ? `style="background-image:url('${esc(x.thumb)}')"` : ''}></div>
        <div><div class="nt">${x.seriesOrder}강. ${esc(x.title)}</div><div class="ns">조회 ${x.views}</div></div></a>`).join('')
    : '<div style="color:var(--muted);font-size:13px">이어지는 강좌가 없습니다.</div>';

  // ---- 컨트롤 ----
  const toggle = () => (v.paused ? v.play() : v.pause());
  v.onclick = $('#big').onclick = $('#play').onclick = toggle;
  v.onplay = v.onpause = () => { pl.classList.toggle('playing', !v.paused); $('#play').textContent = v.paused ? '▶' : '❚❚'; };
  $('#back').onclick = () => (v.currentTime = Math.max(0, v.currentTime - 10));
  $('#fwd').onclick = () => (v.currentTime = Math.min(v.duration || 0, v.currentTime + 10));
  v.onloadedmetadata = () => { $('#dur').textContent = fmtTime(v.duration); if (l.position > 3 && l.position < v.duration - 5) { v.currentTime = l.position; toast(`${fmtTime(l.position)}부터 이어서 재생합니다.`); } };
  let dragging = false;
  v.ontimeupdate = () => { $('#cur').textContent = fmtTime(v.currentTime); if (!dragging && v.duration) seek.value = (v.currentTime / v.duration) * 1000; };
  seek.oninput = () => { dragging = true; if (v.duration) v.currentTime = (seek.value / 1000) * v.duration; };
  seek.onchange = () => (dragging = false);
  const rates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  $('#rate').onclick = () => { const n = rates[(rates.indexOf(v.playbackRate) + 1) % rates.length]; v.playbackRate = n; $('#rate').textContent = `배속 ${n}x`; };
  const fs = () => (document.fullscreenElement ? document.exitFullscreen() : pl.requestFullscreen?.());
  $('#fs').onclick = fs;
  v.ondblclick = fs;
  document.onfullscreenchange = () => pl.classList.toggle('full', !!document.fullscreenElement);
  $('#gear').onclick = (e) => { e.stopPropagation(); $('#menu').classList.toggle('open'); };
  pl.addEventListener('click', (e) => { if (!e.target.closest('#menu') && !e.target.closest('#gear')) $('#menu').classList.remove('open'); });
  let idle; const wake = () => { pl.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => pl.classList.add('idle'), 2500); };
  pl.onmousemove = wake; wake();
  document.onkeydown = (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== 'range') return;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowLeft') $('#back').click();
    else if (e.key === 'ArrowRight') $('#fwd').click();
    else if (e.key === 'f' || e.key === 'F') fs();
  };

  // ---- 자막 설정 (localStorage 에 기억) ----
  const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, x) => { try { localStorage.setItem(k, x); } catch {} } };
  function applySub() {
    const on = store.get('sub.on', 'on') === 'on', size = store.get('sub.size', '22');
    pl.style.setProperty('--cue-size', size + 'px');
    for (const t of v.textTracks) t.mode = on && l.hasSubtitles ? 'showing' : 'hidden';
    document.querySelectorAll('#subOnOff .opt').forEach((b) => b.classList.toggle('on', b.dataset.v === (on ? 'on' : 'off')));
    document.querySelectorAll('#subSize .opt').forEach((b) => b.classList.toggle('on', b.dataset.v === size));
  }
  $('#subOnOff').onclick = (e) => { if (e.target.dataset.v) { store.set('sub.on', e.target.dataset.v); applySub(); } };
  $('#subSize').onclick = (e) => { if (e.target.dataset.v) { store.set('sub.size', e.target.dataset.v); applySub(); } };
  applySub(); v.textTracks.addEventListener?.('addtrack', applySub);
  $('#trk')?.addEventListener('load', applySub);

  // ---- 조회수 / 진행도 / 다음 강의 ----
  let counted = false, lastSave = 0;
  v.addEventListener('timeupdate', () => {
    if (!counted && v.currentTime > 5) { counted = true; api(`/api/lectures/${l.id}/view`, { method: 'POST' }).catch(() => {}); }
    if (me && Date.now() - lastSave > 5000 && v.currentTime > 0) { lastSave = Date.now(); api(`/api/lectures/${l.id}/progress`, { method: 'POST', body: { position: v.currentTime } }).catch(() => {}); }
  });
  v.onended = () => { if (me) api(`/api/lectures/${l.id}/progress`, { method: 'POST', body: { position: 0 } }).catch(() => {}); if (nextLec) { toast('다음 강의로 이동합니다…'); setTimeout(() => (location.href = '/watch.html?id=' + nextLec.id), 1500); } };

  // ---- 즐겨찾기 / 삭제 ----
  $('#fav').onclick = async () => {
    if (!me) return toast('로그인이 필요합니다.');
    l.favorite = !l.favorite;
    await api(`/api/lectures/${l.id}/favorite`, { method: 'POST', body: { on: l.favorite } });
    $('#fav').classList.toggle('on', l.favorite); $('#fav').textContent = l.favorite ? '★ 즐겨찾기됨' : '☆ 즐겨찾기';
  };
  $('#del')?.addEventListener('click', async () => { if (confirm('이 강의를 삭제할까요?')) { await api('/api/lectures/' + l.id, { method: 'DELETE' }); location.href = '/'; } });
})();
