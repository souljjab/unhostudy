// 공통: API 헬퍼, 레이아웃(헤더/사이드바), 로그인 모달
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, opts = {}) {
  const o = { credentials: 'same-origin', ...opts };
  if (o.body && !(o.body instanceof FormData) && typeof o.body !== 'string') {
    o.headers = { 'Content-Type': 'application/json', ...(o.headers || {}) };
    o.body = JSON.stringify(o.body);
  }
  const r = await fetch(url, o);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || '요청에 실패했습니다.'), { status: r.status });
  return data;
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}
const fmtDate = (s) => { const d = new Date(s.replace(' ', 'T') + 'Z'); return `${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };
const fmtTime = (t) => { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };

function lectureCard(l) {
  const style = l.thumb ? `style="background-image:url('${esc(l.thumb)}')"` : '';
  const badge = l.status === 'draft' ? '<span class="badge">임시저장</span>' : l.series ? `<span class="badge">${esc(l.series)} ${l.seriesOrder}강</span>` : '';
  return `<a class="lcard" href="/watch.html?id=${l.id}">
    <div class="thumb" ${style}>${l.thumb ? '' : '▶'}${badge}</div>
    <div class="info"><div class="t">${esc(l.title || '(제목 없음)')}</div>
      <div class="meta"><span>${esc(l.author)}</span><span>${fmtDate(l.createdAt)}</span><span>조회 ${l.views}</span></div></div></a>`;
}

const SCHOOL_LOGO = `<svg class="school" viewBox="0 0 120 130" xmlns="http://www.w3.org/2000/svg" aria-label="운호고등학교">
  <path d="M60 4 L112 18 V64 C112 94 86 116 60 126 C34 116 8 94 8 64 V18 Z" fill="#1d6aa5" stroke="#134b78" stroke-width="4"/>
  <path d="M60 14 L102 26 V62 C102 88 80 106 60 114 C40 106 18 88 18 62 V26 Z" fill="none" stroke="#fff" stroke-width="2"/>
  <text x="60" y="62" text-anchor="middle" font-size="32" font-weight="900" font-style="italic" fill="#fff" font-family="Georgia,serif">Ub</text>
  <text x="60" y="80" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">운호고등학교</text>
  <text x="60" y="108" text-anchor="middle" font-size="12" font-weight="800" fill="#f08a24" letter-spacing="2">UNHO</text></svg>`;

// 페이지 공통 셸. main() 에서 #content 를 채운다.
async function initShell({ q = '' } = {}) {
  document.body.innerHTML = `
    <header class="topbar">
      <a class="brand" href="/"><span class="logo-text">UNHO<small>Study</small></span></a>
      <span class="slogan">학생이 주인되는 <b>당당한 운호인</b></span>${SCHOOL_LOGO}
    </header>
    <div class="layout">
      <aside class="sidebar"><div id="profile"></div><div class="cat-title">카테고리</div><nav id="cats"></nav></aside>
      <main class="content" id="content">
        <form class="search" id="searchForm"><input name="q" placeholder="강의 검색" value="${esc(q)}" autocomplete="off"><button aria-label="검색">🔍</button></form>
        <div id="page"></div>
      </main>
    </div>`;
  $('#searchForm').onsubmit = (e) => { e.preventDefault(); const v = new FormData(e.target).get('q').trim(); location.href = '/' + (v ? '?q=' + encodeURIComponent(v) : ''); };
  const params = new URLSearchParams(location.search);
  const [me, cats] = await Promise.all([api('/api/me'), api('/api/categories')]);
  window.ME = me;
  renderProfile(me);
  renderCats(cats, params.get('category'), params.get('sub'));
  return me;
}
function renderProfile(me) {
  const el = $('#profile');
  if (!me) {
    el.innerHTML = `<div class="profile"><div class="avatar">?</div><div class="who"><b>로그인 해주세요</b><div>로그인 후 이용 가능합니다</div></div></div>
      <div class="pbtns"><button class="primary" id="bLogin">로그인</button><button id="bSignup">회원가입</button></div>`;
    $('#bLogin').onclick = () => authModal('login');
    $('#bSignup').onclick = () => authModal('signup');
    return;
  }
  el.innerHTML = `<div class="profile"><div class="avatar">${esc(me.name.slice(0, 1))}</div>
    <div class="who"><b>${esc(me.name)}님</b><div>연속접속일수: ${me.streak}일<br>수강중인강좌: ${me.watching}개</div></div></div>
    <div class="pbtns"><button id="bEdit">프로필수정</button><button id="bOut">로그아웃</button>
      <button id="bFav">즐겨찾기</button><button class="primary" id="bUp">강의 업로드</button></div>`;
  $('#bEdit').onclick = profileModal;
  $('#bOut').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.href = '/'; };
  $('#bFav').onclick = () => (location.href = '/?scope=favorites');
  $('#bUp').onclick = () => (location.href = '/upload.html');
}
function renderCats(cats, cur, curSub) {
  $('#cats').innerHTML = `<div class="cat"><a href="/" class="cat-head ${!cur ? 'active' : ''}" style="border-bottom:0">전체 강의</a></div>` +
    Object.entries(cats).map(([c, subs]) => `
    <div class="cat ${cur === c ? 'open' : ''}"><button class="cat-head ${cur === c && !curSub ? 'active' : ''}">${esc(c)}</button>
      <div class="subs"><a href="/?category=${encodeURIComponent(c)}" class="${cur === c && !curSub ? 'active' : ''}">전체</a>
      ${subs.map((s) => `<a href="/?category=${encodeURIComponent(c)}&sub=${encodeURIComponent(s)}" class="${cur === c && curSub === s ? 'active' : ''}">${esc(s)}</a>`).join('')}</div></div>`).join('');
  document.querySelectorAll('button.cat-head').forEach((b) => (b.onclick = () => b.parentElement.classList.toggle('open')));
}
function modal(html) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener('mousedown', (e) => e.target === bg && bg.remove());
  document.body.appendChild(bg);
  return bg;
}
function authModal(mode) {
  const signup = mode === 'signup';
  const bg = modal(`<h2>${signup ? '회원가입' : '로그인'}</h2><form>
    <div class="field"><label>아이디</label><input class="input" name="username" required autocomplete="username"></div>
    ${signup ? '<div class="field"><label>이름</label><input class="input" name="name" required></div>' : ''}
    <div class="field"><label>비밀번호</label><input class="input" type="password" name="password" required autocomplete="${signup ? 'new' : 'current'}-password"></div>
    <div class="err"></div>
    <div class="mfoot"><button type="button" class="link">${signup ? '로그인으로' : '회원가입으로'}</button><button class="btn primary">${signup ? '가입하기' : '로그인'}</button></div></form>`);
  $('.link', bg).onclick = () => { bg.remove(); authModal(signup ? 'login' : 'signup'); };
  $('form', bg).onsubmit = async (e) => {
    e.preventDefault();
    try { await api(signup ? '/api/signup' : '/api/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); location.reload(); }
    catch (err) { $('.err', bg).textContent = err.message; }
  };
}
function profileModal() {
  const bg = modal(`<h2>프로필 수정</h2><form>
    <div class="field"><label>이름</label><input class="input" name="name" value="${esc(ME.name)}" required></div>
    <div class="field"><label>새 비밀번호 (변경 시에만)</label><input class="input" type="password" name="password" autocomplete="new-password"></div>
    <div class="err"></div><div class="mfoot"><span></span><button class="btn primary">저장</button></div></form>`);
  $('form', bg).onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    if (!body.password) delete body.password;
    try { await api('/api/me', { method: 'PUT', body }); location.reload(); } catch (err) { $('.err', bg).textContent = err.message; }
  };
}
