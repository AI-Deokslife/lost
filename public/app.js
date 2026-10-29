import {
  api, $, $$, esc, icon, boot, toast, toastError, openSheet, successMark, placeText, ddayTag, mediaHtml, options,
  setupTabs, kstToday, catIcon, relDate, emptyHtml, skeletonCards, withRo, pullToRefresh, installBanner, shareLink,
} from '/common.js';

// 공유 링크(/#item=번호)로 들어오면 그 물건을 바로 열기
const deepItem = +(location.hash.match(/^#item=(\d+)/)?.[1] || 0);

// 정적 아이콘 채우기
$('#logo').innerHTML = icon('search');
$('#logoutBtn').innerHTML = icon('log-out');
$('#searchIcon').outerHTML = icon('search');
$('#tabbar').innerHTML = `
  <button data-tab="browse">${icon('search')}<span>찾기</span></button>
  <button data-tab="report">${icon('megaphone')}<span>분실 신고</span></button>
  <button data-tab="mine">${icon('inbox')}<span>내 신청</span><span class="badge-dot hidden" id="cMine"></span></button>`;
$('#grid').innerHTML = skeletonCards();

const { config } = await boot();
let items = [];
let category = '';

$('#fCategory').innerHTML = [['', 'layers', '전체'], ...config.categories.map(c => [c, null, c])]
  .map(([v, ic, label]) => `<button class="pill${v === '' ? ' on' : ''}" data-cat="${esc(v)}">${ic ? icon(ic) : catIcon(v)}${esc(label)}</button>`).join('');
$('#fLocation').innerHTML = options(config.locations, '', '모든 장소');
$('#fColor').innerHTML = options(config.colors, '', '모든 색상');
$('#rCategory').innerHTML = config.categories.map(c =>
  `<label><input type="radio" name="category" value="${esc(c)}" required><span>${catIcon(c)}${esc(c)}</span></label>`).join('');
$('#rColor').innerHTML = options(config.colors, '', '모름');
$('#rLocation').innerHTML = options(config.locations, '', '모름');
$('#rDate').value = kstToday();
$('#rDate').max = kstToday();

// ---------- 갤러리 ----------
function card(item) {
  const tags = [ddayTag(item), item.status === 'requested' ? '<span class="tag orange">신청 확인 중</span>' : ''].join('');
  const eyebrow = item.days_left <= 7 ? `<div class="eyebrow">${item.days_left <= 0 ? '곧 처리 예정' : `${item.days_left}일 남음`}</div>`
    : relDate(item.found_date) === '오늘' ? '<div class="eyebrow blue">새로 들어왔어요</div>' : '';
  return `<button class="card" data-item="${item.id}">
    ${mediaHtml(item, 'media', tags)}
    <div class="body">
      ${eyebrow}
      <div class="title">${esc(item.description || item.category)}</div>
      <div class="meta">${esc(placeText(item))} · ${relDate(item.found_date)}</div>
    </div>
  </button>`;
}

function render() {
  const q = $('#q').value.trim().toLowerCase();
  const loc = $('#fLocation').value, color = $('#fColor').value, period = +$('#fPeriod').value;
  const since = period ? new Date(Date.parse(kstToday()) - period * 86400_000).toISOString().slice(0, 10) : '';
  const filtered = !!(q || category || loc || color || period);
  const list = items.filter(i =>
    (!category || i.category === category) && (!loc || i.location === loc) && (!color || i.color === color) &&
    (!since || i.found_date >= since) &&
    (!q || [i.description, i.category, i.location, i.location_detail, i.color, i.reg_no].join(' ').toLowerCase().includes(q)));
  [['#fLocation', loc], ['#fColor', color], ['#fPeriod', period]].forEach(([s, v]) => $(s).parentElement.classList.toggle('on', !!v));
  $('#lead').textContent = items.length ? `${items.length}개의 물건이 주인을 기다리고 있어요.` : '지금은 보관 중인 물건이 없어요.';
  $('#gridTitle').textContent = filtered ? '검색 결과' : '모든 분실물';
  $('#count').textContent = `${list.length}개`;
  $('#grid').innerHTML = list.map(card).join('') ||
    (items.length ? emptyHtml('찾는 물건이 없어요', '검색어나 필터를 바꿔 보세요.<br>못 찾으면 ‘분실 신고’를 남겨 주세요.', 'search')
                  : emptyHtml('보관 중인 분실물이 없어요', '모두 주인을 찾았어요.', 'circle-check'));
  const soon = filtered ? [] : items.filter(i => i.days_left <= 7).sort((a, b) => a.days_left - b.days_left);
  $('#soon').classList.toggle('hidden', !soon.length);
  $('#soonList').innerHTML = soon.map(card).join('');
}

async function load() {
  try { items = await api('/api/items'); render(); }
  catch (e) { toastError(e); }
}

$('#fCategory').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  category = b.dataset.cat;
  $$('#fCategory .pill').forEach(p => p.classList.toggle('on', p === b));
  render();
});
['#q', '#fLocation', '#fColor', '#fPeriod'].forEach(s => $(s).addEventListener('input', render));
document.addEventListener('click', e => {
  const c = e.target.closest('[data-item]');
  if (c) detailSheet(+c.dataset.item);
});

// ---------- 상세 / 수령 신청 시트 ----------
function infoRows(item) {
  const rows = [
    ['등록번호', esc(item.reg_no)],
    ['품목', `${esc(item.category)}${item.color ? ' · ' + esc(item.color) : ''}`],
    ['주운 곳', esc(placeText(item))],
    ['주운 날', `${esc(item.found_date)} (${relDate(item.found_date)})`],
    ['보관 기한', `${esc(item.deadline)}${item.days_left <= 7 ? ` <span class="tag red">${item.days_left <= 0 ? '지남' : 'D-' + item.days_left}</span>` : ''}`],
  ];
  return `<div class="group">${rows.map(([k, v]) => `<div class="cell"><span class="label">${k}</span><span class="value">${v}</span></div>`).join('')}</div>`;
}

async function detailSheet(id) {
  let item = items.find(i => i.id === id);
  if (!item) { await load(); item = items.find(i => i.id === id); }
  if (!item) return toast('이미 처리된 물건이에요.', { error: true });
  const sheet = openSheet({
    title: '',
    body: `
      <div class="sheet-hero">${mediaHtml(item, 'media')}</div>
      <div class="row-tags">${item.status === 'requested' ? '<span class="tag otint">다른 신청 확인 중</span>' : ''}${item.valuable ? '<span class="tag gray">귀중품</span>' : ''}</div>
      <h2>${esc(item.description || item.category)}</h2>
      <p class="muted" style="margin:0 0 18px">${esc(placeText(item))}에서 ${relDate(item.found_date)} 주웠어요.</p>
      ${infoRows(item)}
      ${item.valuable ? `<div class="info-box">${icon('shield-check')}<span>귀중품은 사진을 공개하지 않아요. 찾으러 오면 안에 든 물건 등을 물어 본인인지 확인해요.</span></div>` : ''}
      <div class="foot"><button class="btn primary" id="toClaim">내 것 같아요</button></div>
      <div class="share-row" style="margin-top:10px"><button class="btn" id="share">${icon('share')}친구에게 알려주기</button></div>`,
  });
  $('#toClaim', sheet).addEventListener('click', () => claimForm(sheet, item));
  $('#share', sheet).addEventListener('click', () => shareLink({
    title: config.siteName,
    text: `혹시 이거 네 거 아니야? ${item.description || item.category} (${placeText(item)}에서 주움)`,
    url: `${location.origin}/#item=${item.id}`,
  }));
}

function claimForm(sheet, item) {
  sheet.setBody(`
    <p class="muted" style="margin:4px 0 0;text-align:center">${esc(item.description || item.category)} · ${esc(item.reg_no)}</p>
    <form id="claimForm">
      <div class="group-title">누구인가요?</div>
      <div class="group">
        <label class="cell"><span class="label">학번</span><input type="text" name="student_no" required inputmode="numeric" placeholder="10203"></label>
        <label class="cell"><span class="label">이름</span><input type="text" name="student_name" required placeholder="홍길동"></label>
      </div>
      <div class="group-title">내 물건이라는 근거</div>
      <div class="group"><div class="cell stack"><textarea name="detail" required placeholder="예) 케이스 안쪽에 JH 이니셜, 왼쪽 이어폰에 흠집"></textarea></div></div>
      <div class="group-foot">${item.valuable ? '귀중품이라 안에 든 물건, 브랜드, 특징을 자세히 적을수록 빨리 찾을 수 있어요.' : '나만 알 수 있는 특징을 적어 주세요.'}</div>
      <div class="foot"><button type="button" class="btn" id="back">뒤로</button><button class="btn primary">신청하기</button></div>
    </form>`, '수령 신청');
  $('#back', sheet).addEventListener('click', () => { sheet.close(); detailSheet(item.id); });
  $('#claimForm', sheet).addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter || e.target.querySelector('button:not([type=button])'); btn.disabled = true;
    try {
      await api(`/api/items/${item.id}/claim`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      sheet.setBody(`<div class="success">${successMark()}
        <h2 style="margin-top:16px">신청했어요</h2>
        <p class="muted">${esc(config.deptName)}에서 물건을 준비해 둘게요.<br>등록번호 <b class="tnum">${esc(item.reg_no)}</b>를 말하고 찾아가세요.</p></div>
        <div class="foot"><button class="btn primary" data-close>확인</button></div>`, '');
      load(); loadMine();
    } catch (err) { toastError(err); btn.disabled = false; }
  });
}

// ---------- 분실 신고 ----------
$('#reportForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter || e.target.querySelector('button:not([type=button])'); btn.disabled = true;
  try {
    await api('/api/lost-reports', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    e.target.reset();
    $('#rDate').value = kstToday();
    toast('분실 신고를 등록했어요');
    location.hash = '#mine';
  } catch (err) { toastError(err); }
  finally { btn.disabled = false; }
});

// ---------- 내 신청 ----------
const CLAIM_LABEL = { pending: ['확인 중', 'otint'], approved: ['수령 완료', 'green'], rejected: ['반려됨', 'gray'] };
const REPORT_LABEL = { open: ['찾는 중', 'blue'], matched: [`${config.deptName} 연락`, 'green'], closed: ['종료', 'gray'] };

async function loadMine() {
  let data;
  try { data = await api('/api/my'); } catch (e) { return toastError(e); }
  const { claims, reports } = data;
  const pending = claims.filter(c => c.status === 'pending').length;
  const matches = reports.flatMap(r => r.candidates.map(c => c.item));
  const unique = [...new Map(matches.map(i => [i.id, i])).values()];
  const dot = pending + unique.length;
  $('#cMine').textContent = dot;
  $('#cMine').classList.toggle('hidden', !dot);

  $('#matchBanner').innerHTML = unique.length ? `
    <div class="banner">${icon('sparkles', 'big')}<div><b>비슷한 물건이 들어왔어요!</b><span class="muted small">신고한 내용과 비슷한 습득물이 ${unique.length}개 있어요.</span></div></div>
    <div class="hscroll" style="margin-top:14px">${unique.map(card).join('')}</div>` : '';

  $('#myClaims').innerHTML = claims.map(c => {
    const [label, cls] = CLAIM_LABEL[c.status];
    return `<div class="cell">
      <div class="thumb"><div class="ph">${catIcon(c.category)}</div></div>
      <div class="text"><b>${esc(c.item_description || c.category)}</b>
        <small>${esc(c.reg_no)} · ${relDate(c.created_at)} 신청${c.status === 'pending' ? ` · ${esc(withRo(config.deptName))} 찾으러 오세요` : ''}</small></div>
      <span class="tag ${cls}">${label}</span></div>`;
  }).join('') || `<div class="cell"><span class="muted">아직 신청한 물건이 없어요.</span></div>`;

  $('#myReports').innerHTML = reports.map(r => {
    const [label, cls] = REPORT_LABEL[r.status];
    return `<div class="cell">
      <div class="thumb"><div class="ph">${catIcon(r.category)}</div></div>
      <div class="text"><b>${esc(r.detail)}</b>
        <small>${esc(r.location || '장소 모름')} · ${relDate(r.lost_date)} 분실${r.candidates.length ? ` · <span style="color:var(--blue)">비슷한 물건 ${r.candidates.length}개</span>` : ''}</small>
        ${r.status === 'open' ? `<button class="btn plain sm" style="padding-left:0" data-close-report="${r.id}">찾았어요 · 신고 종료</button>` : ''}</div>
      <span class="tag ${cls}">${label}</span></div>`;
  }).join('') || `<div class="cell"><span class="muted">분실 신고 내역이 없어요.</span></div>`;
}
$('#myReports').addEventListener('click', async e => {
  const b = e.target.closest('[data-close-report]');
  if (!b) return;
  try { await api(`/api/lost-reports/${b.dataset.closeReport}/close`, { method: 'POST' }); toast('신고를 종료했어요'); loadMine(); }
  catch (err) { toastError(err); }
});

setupTabs(name => { if (name === 'mine') loadMine(); });
installBanner($('#installSlot'));
pullToRefresh(() => Promise.all([load(), loadMine()]));
await load();
loadMine();
if (deepItem) detailSheet(deepItem);
