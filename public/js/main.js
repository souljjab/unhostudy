(async () => {
  const p = new URLSearchParams(location.search);
  await initShell({ q: p.get('q') || '' });
  const scope = p.get('scope');
  const parts = [];
  if (scope === 'favorites') parts.push('즐겨찾기');
  if (p.get('category')) parts.push(p.get('category'));
  if (p.get('sub')) parts.push(p.get('sub'));
  if (p.get('q')) parts.push(`“${p.get('q')}” 검색결과`);
  const page = $('#page');
  page.innerHTML = `<h2 class="heading">${esc(parts.join(' › ') || '전체 강의')}<small id="count"></small></h2><div class="grid" id="grid"></div>`;
  try {
    const list = await api('/api/lectures?' + p.toString());
    $('#count').textContent = `${list.length}개`;
    $('#grid').innerHTML = list.length ? list.map(lectureCard).join('') : `<div class="empty">${scope === 'favorites' ? '즐겨찾기한 강의가 없습니다.' : '등록된 강의가 없습니다.'}</div>`;
  } catch (e) {
    $('#grid').innerHTML = `<div class="empty">${esc(e.message)}${e.status === 401 ? '<br>사이드바에서 로그인해주세요.' : ''}</div>`;
  }
})();
