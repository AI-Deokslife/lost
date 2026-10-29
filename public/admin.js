import {
  api, $, $$, esc, icon, boot, toast, toastError, openSheet, successMark, placeText, ddayTag, statusTag, mediaHtml,
  options, setupTabs, kstToday, catIcon, relDate, emptyHtml, fillNames, pullToRefresh, installApp, isStandalone,
} from '/common.js';
import { photoEditor } from '/photo-editor.js';

// ---------- 정적 아이콘 ----------
$('#logo').innerHTML = icon('package');
$('#logoutBtn').innerHTML = icon('log-out');
$('#lnStudent').innerHTML = `${icon('smartphone')}<span>학생 화면</span>`;
$('#lnTv').innerHTML = `${icon('tv')}<span>TV 화면</span>`;
$('#camIcon').innerHTML = icon('camera');
$('#warnIcon').outerHTML = icon('circle-alert');
$('#mosaicHint').innerHTML = `${icon('hand')}가릴 곳을 드래그하면 모자이크돼요`;
$('#undo').innerHTML = `${icon('undo-2')}되돌리기`;
$('#repick').innerHTML = `${icon('camera')}다시 찍기`;
$('#aiBtn').innerHTML = `${icon('sparkles')}AI로 채우기`;
$('#lockTile').innerHTML = icon('lock');
$('#deniedIcon').outerHTML = icon('lock');
$('#items .si').outerHTML = icon('search');
const SIDEBAR = [
  ['register', 'camera', '등록'], ['items', 'package', '물품'], ['drops', 'scan-line', '학생 등록', 'cDrops'], ['claims', 'hand', '수령 신청', 'cClaims'],
  ['match', 'puzzle', '분실 신고', 'cReports'], ['expired', 'hourglass', '처리 대상', 'cExpired'],
  ['stats', 'chart-column', '통계'], ['settings', 'settings', '설정'],
];
const COUNT_KEY = { cClaims: 'claims', cReports: 'reports', cExpired: 'expired', cDrops: 'drops' };
$('#sidebar').innerHTML = '<div class="sb-title">분실물 관리</div>' + SIDEBAR.map(([tab, ic, label, cnt]) =>
  `<button data-tab="${tab}">${icon(ic)}<span>${label}</span>${cnt ? `<span class="count hidden" data-count="${COUNT_KEY[cnt]}"></span>` : ''}</button>`).join('');
// 휴대폰: 아래쪽 탭 바 (자주 쓰는 4개 + 더보기)
const MORE_TABS = ['drops', 'expired', 'stats', 'settings'];
$('#atabbar').innerHTML = `
  <button data-tab="register">${icon('camera')}<span>등록</span></button>
  <button data-tab="items">${icon('package')}<span>물품</span></button>
  <button data-tab="claims">${icon('hand')}<span>수령 신청</span><span class="badge-dot hidden" data-count="claims"></span></button>
  <button data-tab="match">${icon('puzzle')}<span>분실 신고</span><span class="badge-dot hidden" data-count="reports"></span></button>
  <button id="moreBtn">${icon('ellipsis')}<span>더보기</span><span class="badge-dot hidden" data-count="more"></span></button>`;

const { config, me } = await boot();
if (me.role !== 'admin') {
  $('#sidebar').classList.add('hidden');
  $$('main > section').forEach(s => s.classList.toggle('hidden', s.id !== 'denied'));
  throw new Error('관리자 아님');
}

const segValue = id => $(`#${id} .on`).dataset.v;
function setupSeg(id, onChange) {
  $(`#${id}`).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    $$(`#${id} button`).forEach(x => x.classList.toggle('on', x === b));
    onChange(b.dataset.v);
  });
}

// =====================================================
// 등록
// =====================================================
const chips = (name, list, ic = () => '') => list.map(v =>
  `<label><input type="radio" name="${name}" value="${esc(v)}" required><span>${ic(v)}${esc(v)}</span></label>`).join('');
function renderRegChoices() {
  $('#regCategory').innerHTML = chips('category', config.categories, c => catIcon(c));
  $('#regLocation').innerHTML = chips('location', config.locations);
  $('#regColor').innerHTML = options(config.colors, '', '선택 안 함');
}
renderRegChoices();
$('#regDate').value = kstToday();
$('#regDate').max = kstToday();

const editor = photoEditor($('#canvas'), { onDragStart: () => $('#mosaicHint').classList.add('hidden') });

$('#pick').addEventListener('click', () => $('#file').click());
$('#repick').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try { await editor.load(file); } catch { return toast('이 사진 형식은 열 수 없어요.', { error: true }); }
  $('#editorWrap').classList.remove('hidden');
  $('#pick').classList.add('hidden');
  $('#sensitive').classList.add('hidden');
  e.target.value = '';
  if (config.aiEnabled) runAi();
});
$('#undo').addEventListener('click', () => editor.undo());
$('#removePhoto').addEventListener('click', resetPhoto);
function resetPhoto() {
  editor.reset();
  $('#editorWrap').classList.add('hidden');
  $('#pick').classList.remove('hidden');
  $('#mosaicHint').classList.remove('hidden');
}

$('#aiBtn').addEventListener('click', runAi);
async function runAi() {
  if (!editor.hasPhoto) return;
  const btn = $('#aiBtn');
  btn.disabled = true; btn.classList.add('loading');
  btn.innerHTML = `${icon('sparkles')}분석 중…`;
  try {
    const r = await api('/api/admin/ai-tag', { method: 'POST', body: { image: editor.toDataUrl() } });
    const form = $('#regForm');
    if (r.category) { form.category.value = r.category; onCategory(); }
    if (r.color) form.color.value = r.color;
    if (r.description && !form.description.value) form.description.value = r.description;
    if (r.valuable) $('#regValuable').checked = true;
    $('#sensitive').classList.toggle('hidden', !r.sensitive);
    toast('AI가 채웠어요. 맞는지 확인해 주세요');
  } catch (err) {
    toastError(err);
  } finally {
    btn.disabled = false; btn.classList.remove('loading');
    btn.innerHTML = `${icon('sparkles')}AI로 채우기`;
  }
}

function onCategory() {
  if (config.valuableCategories.includes($('#regForm').category.value)) $('#regValuable').checked = true;
}
$('#regCategory').addEventListener('change', onCategory);

$('#regForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (editor.hasPhoto) fd.append('photo', await editor.toBlob(), 'photo.jpg');
  const btn = $('#regSubmit');
  btn.disabled = true; btn.textContent = '등록 중…';
  try {
    const item = await api('/api/admin/items', { method: 'POST', body: fd });
    e.target.reset();
    $('#regDate').value = kstToday();
    resetPhoto();
    const sheet = openSheet({
      body: `<div class="success">${successMark()}
        <p class="muted" style="margin:18px 0 0">등록번호</p>
        <h2 class="tnum" style="font-size:44px;margin:0">${esc(item.reg_no)}</h2>
        <p class="muted">물건에 이 번호를 적은 메모나 라벨을 붙여 보관하세요.</p></div>
        ${item.matching_reports ? `<div class="info-box">${icon('puzzle')}<span><b>비슷한 분실 신고가 ${item.matching_reports}건 있어요.</b> 학생 화면에도 자동으로 알려 줬어요.</span></div>` : ''}
        <div class="foot">
          ${item.matching_reports ? '<button class="btn" id="goMatch">신고 보기</button>' : ''}
          <button class="btn primary" data-close>계속 등록하기</button></div>`,
    });
    $('#goMatch', sheet)?.addEventListener('click', () => { sheet.close(); location.hash = '#match'; });
    updateCounts();
  } catch (err) { toastError(err); }
  finally { btn.disabled = false; btn.textContent = '등록하기'; }
});

// =====================================================
// 물품
// =====================================================
const itemCache = new Map();
const remember = list => { list.forEach(i => itemCache.set(i.id, i)); return list; };

function itemRow(i, { pick = false } = {}) {
  const extra = i.status === 'returned' ? ` · ${esc(i.returned_to)} 수령`
    : i.status === 'disposed' ? ` · ${esc(i.disposal_type)}` : '';
  return `<div class="cell ${pick ? '' : 'tap'}" ${pick ? '' : `data-open="${i.id}"`}>
    ${pick ? `<label class="checkcircle"><input type="checkbox" class="pick" value="${i.id}"><span></span></label>` : ''}
    <div class="thumb">${mediaHtml(i, 'media')}</div>
    <div class="text">
      <div class="row-title">${esc(i.description || i.category)}</div>
      <div class="row-sub"><span class="regno">${esc(i.reg_no)}</span> · ${esc(placeText(i))} · ${relDate(i.found_date)}${extra}</div>
      <div class="row-tags">${i.reviewed === false ? '<span class="tag rtint">비공개 · 확인 대기</span>' : ''}${statusTag(i)}${ddayTag(i)}${i.source === 'student' ? '<span class="tag gray">학생 등록</span>' : ''}${i.valuable ? '<span class="tag gray">귀중품</span>' : ''}${i.pending_claims ? `<span class="tag otint">신청 ${i.pending_claims}</span>` : ''}</div>
    </div>
    ${pick ? '' : icon('chevron-right', 'chev')}
  </div>`;
}

let allItems = [];
async function loadItems() {
  try { allItems = remember(await api('/api/admin/items?status=' + segValue('istatus'))); } catch (e) { return toastError(e); }
  renderItems();
}
function renderItems() {
  const q = $('#iq').value.trim().toLowerCase();
  const list = allItems.filter(i => !q || [i.reg_no, i.category, i.description, i.location, i.location_detail, i.color, i.returned_to].join(' ').toLowerCase().includes(q));
  $('#itemsLead').textContent = `${list.length}개`;
  $('#itemList').innerHTML = list.map(i => itemRow(i)).join('') || emptyHtml('해당하는 물품이 없어요', '', 'package');
}
setupSeg('istatus', loadItems);
$('#iq').addEventListener('input', renderItems);

const patch = (id, body) => api(`/api/admin/items/${id}`, { method: 'PATCH', body });

document.addEventListener('click', e => {
  const o = e.target.closest('[data-open]');
  if (o && !e.target.closest('.sheet') && !e.target.closest('.checkcircle')) itemSheet(itemCache.get(+o.dataset.open));
});

// 학생 등록 물건의 상태 표시 (공개 여부 / 상점)
const mmdd = d => (d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : '');
const pubTag = i => (i.source !== 'student' && i.reviewed !== false ? ''
  : i.reviewed === false ? `<span class="tag rtint">${icon('eye-off')}확인 대기 · 비공개</span>` : `<span class="tag green">${icon('eye')}공개 중</span>`);
const meritLabel = i => ({
  pending: '<span class="tag otint">🏅 상점 대상</span>',
  given: `<span class="tag green">🏅 상점 부여 완료 ${mmdd(i.merit_at)}</span>`,
  none: '<span class="tag gray">상점 제외</span>',
}[i.merit] || '');
// 되돌리기 짝
const UNDO = { approve: 'unapprove', unapprove: 'approve', merit: 'unmerit', unmerit: 'merit', exclude: 'include', include: 'exclude' };
const ACTION_DONE = { approve: '공개했어요', unapprove: '공개를 취소했어요', merit: '상점 부여를 기록했어요', unmerit: '상점 부여를 취소했어요', exclude: '상점에서 제외했어요', include: '상점 대상으로 되돌렸어요' };
async function bulkDrop(action, ids, { undoable = true } = {}) {
  await api('/api/admin/drops/bulk', { method: 'POST', body: { action, ids } });
  toast(`${ids.length > 1 ? ids.length + '개 ' : ''}${ACTION_DONE[action]}`, undoable ? {
    action: { label: '되돌리기', run: async () => { try { await bulkDrop(UNDO[action], ids, { undoable: false }); } catch (e) { toastError(e); } } },
  } : {});
  refresh();
}

function itemSheet(item) {
  if (!item) return;
  const active = ['stored', 'requested'].includes(item.status);
  const rows = [
    ['등록번호', `<span class="tnum">${esc(item.reg_no)}</span>`], ['상태', statusTag(item)],
    ['품목', `${esc(item.category)}${item.color ? ' · ' + esc(item.color) : ''}`], ['주운 곳', esc(placeText(item))],
    ['주운 날', esc(item.found_date)], ['보관 기한', `${esc(item.deadline)} ${ddayTag(item)}`],
    ...(item.source === 'student' ? [['주운 학생', `${esc(item.finder_no)} ${esc(item.finder_name)}`], ['학생 화면', pubTag(item)]] : []),
    ...(item.merit ? [['상점', meritLabel(item)]] : []),
    ...(item.returned_to ? [['받은 학생', `${esc(item.returned_to)} (${esc(item.returned_at)})`]] : []),
    ...(item.disposal_type ? [['처리', `${esc(item.disposal_type)} (${esc(item.disposed_at)})`]] : []),
  ];
  const sheet = openSheet({
    body: `<div class="sheet-hero">${mediaHtml(item, 'media')}</div>
      <h2>${esc(item.description || item.category)}</h2>
      <div class="row-tags" style="margin-bottom:16px">${item.valuable ? '<span class="tag gray">귀중품 · 학생에게 사진 비공개</span>' : ''}${item.pending_claims ? `<span class="tag otint">수령 신청 ${item.pending_claims}건</span>` : ''}</div>
      ${item.source === 'student' || item.merit ? `<div class="group" style="margin-bottom:20px">
        ${item.reviewed === false ? `<div class="cell tap" data-a="approve"><span class="icon-tile" style="background:var(--blue)">${icon('eye')}</span><span class="text"><b>확인 · 학생에게 공개</b><small>지금은 학생 화면에 보이지 않아요</small></span></div>`
          : item.source === 'student' ? `<div class="cell tap" data-a="unapprove"><span class="icon-tile" style="background:#8e8e93">${icon('eye-off')}</span><span class="text"><b>공개 취소</b><small>학생 화면에서 다시 숨겨요</small></span></div>` : ''}
        ${item.merit === 'pending' ? `<div class="cell tap" data-a="merit"><span class="icon-tile" style="background:#ff9500">${icon('circle-check')}</span><span class="text"><b>상점 부여 완료</b><small>${esc(item.finder_name || '')} 학생에게 상점을 줬어요</small></span></div><div class="cell tap" data-a="exclude"><span class="icon-tile" style="background:#8e8e93">${icon('x')}</span><span class="text"><b>상점 제외</b></span></div>` : ''}
        ${item.merit === 'given' ? `<div class="cell tap" data-a="unmerit"><span class="icon-tile" style="background:var(--red)">${icon('undo-2')}</span><span class="text"><b>상점 부여 취소</b><small>부여 기록을 지우고 다시 상점 대상으로</small></span></div>` : ''}
        ${item.merit === 'none' ? `<div class="cell tap" data-a="include"><span class="icon-tile" style="background:#8e8e93">${icon('undo-2')}</span><span class="text"><b>다시 상점 대상으로</b></span></div>` : ''}
      </div>` : ''}
      <div class="group">${rows.map(([k, v]) => `<div class="cell"><span class="label">${k}</span><span class="value">${v}</span></div>`).join('')}</div>
      <div class="group" style="margin-top:20px">
        ${active ? `<div class="cell tap" data-a="return"><span class="icon-tile" style="background:var(--green)">${icon('check')}</span><span class="text"><b>수령 처리</b></span>${icon('chevron-right', 'chev')}</div>
          <div class="cell tap" data-a="dispose"><span class="icon-tile" style="background:#8e8e93">${icon('gift')}</span><span class="text"><b>폐기 · 기부</b></span>${icon('chevron-right', 'chev')}</div>`
        : `<div class="cell tap" data-a="restore"><span class="icon-tile" style="background:var(--blue)">${icon('undo-2')}</span><span class="text"><b>보관 중으로 되돌리기</b></span></div>`}
        <div class="cell tap" data-a="edit"><span class="icon-tile" style="background:var(--orange)">${icon('pencil')}</span><span class="text"><b>정보 수정</b></span>${icon('chevron-right', 'chev')}</div>
        <div class="cell tap" data-a="delete"><span class="icon-tile" style="background:var(--red)">${icon('trash-2')}</span><span class="text"><b style="color:var(--red)">삭제</b></span></div>
      </div>`,
  });
  sheet.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    try {
      if (a === 'return') return returnForm(sheet, item);
      if (a === 'dispose') return disposeForm(sheet, item);
      if (a === 'edit') return editForm(sheet, item);
      if (a === 'restore') await patch(item.id, { action: 'restore' });
      if (UNDO[a]) { sheet.close(); return bulkDrop(a, [item.id]); }
      if (a === 'delete') {
        if (!confirm(`${item.reg_no} 물품을 완전히 삭제할까요?\n사진과 신청 기록도 함께 삭제돼요.`)) return;
        await api(`/api/admin/items/${item.id}`, { method: 'DELETE' });
      }
      sheet.close(); toast('처리했어요'); refresh();
    } catch (err) { toastError(err); }
  });
}

function sheetForm(sheet, title, html, submitLabel, onSubmit) {
  sheet.setBody(`<form>${html}<div class="foot"><button type="button" class="btn" data-close>취소</button><button class="btn primary">${submitLabel}</button></div></form>`, title);
  $('form', sheet).addEventListener('submit', async e => {
    e.preventDefault();
    try { await onSubmit(Object.fromEntries(new FormData(e.target))); sheet.close(); toast('저장했어요'); refresh(); }
    catch (err) { toastError(err); }
  });
}
function returnForm(sheet, item) {
  sheetForm(sheet, '수령 처리', `
    ${item.valuable ? `<div class="info-box">${icon('shield-check')}<span><b>귀중품이에요.</b> 안에 든 물건 등 학생만 알 수 있는 특징을 확인한 뒤 돌려주세요.</span></div>` : ''}
    <div class="group-title">받은 학생</div>
    <div class="group"><label class="cell"><span class="label">학번 이름</span><input type="text" name="returned_to" required placeholder="10203 홍길동"></label></div>`,
  '수령 완료', f => patch(item.id, { action: 'return', returned_to: f.returned_to }));
}
function disposeForm(sheet, item) {
  sheetForm(sheet, '폐기 · 기부', `
    <div class="group-title">처리 방법</div>
    <div class="group"><div class="cell stack"><div class="chips">
      <label><input type="radio" name="type" value="기부" required checked><span>${icon('gift')}기부</span></label>
      <label><input type="radio" name="type" value="폐기"><span>${icon('trash-2')}폐기</span></label></div></div></div>`,
  '처리하기', f => patch(item.id, { action: 'dispose', type: f.type }));
}
function editForm(sheet, item) {
  sheetForm(sheet, '정보 수정', `
    <div class="group-title">물건</div>
    <div class="group">
      <label class="cell"><span class="label">품목</span><select name="category">${options(config.categories, item.category)}</select></label>
      <label class="cell"><span class="label">색상</span><select name="color">${options(config.colors, item.color, '선택 안 함')}</select></label>
      <label class="cell"><span class="label">설명</span><input type="text" name="description" value="${esc(item.description || '')}"></label>
    </div>
    <div class="group-title">주운 곳</div>
    <div class="group">
      <label class="cell"><span class="label">장소</span><select name="location">${options([...new Set([...config.locations, item.location])], item.location)}</select></label>
      <label class="cell"><span class="label">세부 장소</span><input type="text" name="location_detail" value="${esc(item.location_detail || '')}"></label>
      <label class="cell"><span class="label">주운 날</span><input type="date" name="found_date" value="${esc(item.found_date)}"></label>
    </div>
    <div class="group" style="margin-top:20px"><label class="cell"><span class="text"><b>귀중품</b><small>학생에게 사진 비공개</small></span>
      <span class="switch"><input type="checkbox" name="valuable" value="1" ${item.valuable ? 'checked' : ''}><span></span></span></label></div>`,
  '저장', f => patch(item.id, { action: 'update', fields: { ...f, valuable: f.valuable === '1' } }));
}

// =====================================================
// 학생 등록 (교무실 QR로 학생이 직접 등록)
// =====================================================
// 탭마다 한꺼번에 할 수 있는 일
const DROP_BULK = {
  review: [['approve', 'primary', '확인 · 공개']],
  public: [['unapprove', 'destructive', '공개 취소']],
  merit: [['exclude', 'plain', '상점 제외'], ['merit', 'primary', '상점 부여']],
  given: [['unmerit', 'destructive', '상점 부여 취소']],
  all: [],
};
function dropRow(i, pick) {
  return `<div class="cell tap" data-open="${i.id}">
    ${pick ? `<label class="checkcircle"><input type="checkbox" class="dpick" value="${i.id}"><span></span></label>` : ''}
    <div class="thumb">${mediaHtml(i, 'media')}</div>
    <div class="text">
      <div class="row-title">${esc(i.description || i.category)}</div>
      <div class="row-sub"><span style="color:var(--label);font-weight:600">${esc(i.finder_no)} ${esc(i.finder_name)}</span> · ${esc(placeText(i))} · ${relDate(i.created_at)}</div>
      <div class="row-tags">${pubTag(i)}${meritLabel(i)}${statusTag(i)}<span class="regno">${esc(i.reg_no)}</span></div>
    </div>${icon('chevron-right', 'chev')}</div>`;
}
async function loadDrops() {
  const f = segValue('dstatus');
  let list;
  try { list = remember(await api('/api/admin/drops?filter=' + f)); } catch (e) { return toastError(e); }
  $('#dropHint').innerHTML = f === 'review' && list.length
    ? `<div class="info-box">${icon('hand')}<span>학생이 가져온 물건과 사진이 맞는지 확인하고 <b>확인 · 공개</b>를 눌러 주세요.</span></div>` : '';
  const acts = DROP_BULK[f];
  $('#dropList').innerHTML = list.map(i => dropRow(i, acts.length)).join('') ||
    emptyHtml({ review: '확인할 물건이 없어요', public: '공개 중인 학생 등록 물건이 없어요', merit: '상점 줄 학생이 없어요',
      given: '상점을 부여한 기록이 없어요', all: '학생이 등록한 물건이 없어요' }[f],
      f === 'all' ? '설정 → 학생 직접 등록에서 QR 포스터를 뽑아 교무실에 두세요.' : '', 'scan-line');
  $('#dropActions').innerHTML = acts.map(([a, cls, label]) => `<button class="btn sm ${cls}" data-dbulk="${a}">${label}</button>`).join('');
  $('#dropBar').classList.toggle('hidden', !list.length || !acts.length);
  updateDropBar();
}
function updateDropBar() {
  const n = $$('#dropList .dpick:checked').length;
  $('#dropCount').textContent = n ? `${n}개 선택됨` : '물건을 선택하세요';
  $$('[data-dbulk]').forEach(b => (b.disabled = !n));
}
setupSeg('dstatus', loadDrops);
$('#dropList').addEventListener('change', updateDropBar);
$('#dropAll').addEventListener('click', () => {
  const all = $$('#dropList .dpick');
  const on = all.some(c => !c.checked);
  all.forEach(c => (c.checked = on));
  updateDropBar();
});
$('#dropActions').addEventListener('click', async e => {
  const b = e.target.closest('[data-dbulk]');
  const ids = $$('#dropList .dpick:checked').map(c => +c.value);
  if (!b || !ids.length) return;
  try { await bulkDrop(b.dataset.dbulk, ids); } catch (err) { toastError(err); }
});

// =====================================================
// 수령 신청
// =====================================================
async function loadClaims() {
  let list;
  try { list = await api('/api/admin/claims?status=pending'); } catch (e) { return toastError(e); }
  $('#claimList').innerHTML = list.map(c => `<div class="card-box">
    <div style="display:flex;gap:14px;align-items:flex-start">
      <div class="thumb lg">${mediaHtml({ id: c.item_id, has_photo: !!c.has_photo, category: c.category }, 'media')}</div>
      <div style="flex:1;min-width:0">
        <div class="row-sub"><span class="regno">${esc(c.reg_no)}</span> · ${esc(c.item_description || c.category)} · ${esc(placeText(c))}</div>
        <div class="row-title" style="font-size:19px;margin-top:2px">${esc(c.student_no)} ${esc(c.student_name)}</div>
        <div class="row-tags"><span class="tag otint">${relDate(c.created_at)} 신청</span>${c.valuable ? '<span class="tag gray">귀중품</span>' : ''}</div>
      </div>
    </div>
    <div class="quote">“${esc(c.detail)}”</div>
    ${c.valuable ? `<div class="info-box">${icon('shield-check')}<span>안에 든 물건 등을 물어 본인인지 확인한 뒤 돌려주세요.</span></div>` : ''}
    <div class="actions">
      <button class="btn primary" data-claim-act="approve" data-id="${c.id}">${icon('check')}본인 확인 · 수령 완료</button>
      <button class="btn destructive" data-claim-act="reject" data-id="${c.id}">반려</button>
    </div></div>`).join('') || emptyHtml('대기 중인 신청이 없어요', '학생이 “내 것 같아요”를 누르면 여기에 나타나요.', 'inbox');
}
$('#claimList').addEventListener('click', async e => {
  const b = e.target.closest('[data-claim-act]');
  if (!b) return;
  if (b.dataset.claimAct === 'reject' && !confirm('이 신청을 반려할까요?')) return;
  try {
    await api(`/api/admin/claims/${b.dataset.id}/${b.dataset.claimAct}`, { method: 'POST' });
    toast(b.dataset.claimAct === 'approve' ? '수령 완료로 처리했어요' : '반려했어요'); refresh();
  } catch (err) { toastError(err); }
});

// =====================================================
// 분실 신고 매칭
// =====================================================
async function loadReports() {
  const status = segValue('rstatus');
  let list;
  try { list = await api('/api/admin/lost-reports?status=' + status); } catch (e) { return toastError(e); }
  list.forEach(r => remember(r.candidates.map(c => c.item)));
  $('#reportList').innerHTML = list.map(r => `<div class="card-box">
    <div style="display:flex;gap:14px;align-items:flex-start">
      <div class="thumb lg"><div class="ph">${catIcon(r.category)}</div></div>
      <div style="flex:1;min-width:0">
        <div class="row-title" style="font-size:18px">${esc(r.detail)}</div>
        <div class="row-sub">${esc(r.student_no)} ${esc(r.student_name)} · ${relDate(r.lost_date)} 분실</div>
        <div class="row-tags"><span class="tag blue">${esc(r.category)}</span>${r.color ? `<span class="tag gray">${esc(r.color)}</span>` : ''}${r.location ? `<span class="tag gray">${esc(r.location)}</span>` : ''}</div>
      </div>
    </div>
    <div class="group-title" style="margin:18px 0 7px">${r.candidates.length ? `매칭 후보 ${r.candidates.length}개` : '아직 비슷한 습득물이 없어요'}</div>
    ${r.candidates.length ? `<div class="group" style="background:var(--bg)">${r.candidates.map(c => `<div class="cell tap" style="background:transparent" data-open="${c.item.id}">
        <div class="thumb">${mediaHtml(c.item, 'media')}</div>
        <div class="text"><div class="row-title">${esc(c.item.description || c.item.category)}</div>
          <div class="row-sub"><span class="regno">${esc(c.item.reg_no)}</span> · ${esc(placeText(c.item))} · ${relDate(c.item.found_date)}</div>
          <div class="row-tags"><span class="tag green">${icon('check')}${esc(c.reasons.join(' · '))}</span></div></div>
        ${icon('chevron-right', 'chev')}</div>`).join('')}</div>` : ''}
    <div class="actions">
      ${status !== 'matched' ? `<button class="btn primary sm" data-report="${r.id}" data-status="matched">${icon('phone')}학생에게 연락함</button>` : ''}
      ${status !== 'closed' ? `<button class="btn sm" data-report="${r.id}" data-status="closed">종료</button>` : ''}
      ${status !== 'open' ? `<button class="btn sm" data-report="${r.id}" data-status="open">${icon('undo-2')}찾는 중으로</button>` : ''}
    </div>
  </div>`).join('') || emptyHtml('신고가 없어요', '', 'inbox');
}
setupSeg('rstatus', loadReports);
$('#reportList').addEventListener('click', async e => {
  const b = e.target.closest('[data-report]');
  if (!b) return;
  try { await api(`/api/admin/lost-reports/${b.dataset.report}/status`, { method: 'POST', body: { status: b.dataset.status } }); toast('변경했어요'); refresh(); }
  catch (err) { toastError(err); }
});

// =====================================================
// 처리 대상
// =====================================================
function setRetentionHint() {
  $('#retentionHint').textContent = `주운 지 ${config.retentionDays}일이 지난 물건이에요. 골라서 한 번에 기부하거나 폐기하세요.`;
}
setRetentionHint();
async function loadExpired() {
  let list;
  try { list = remember(await api('/api/admin/expired')); } catch (e) { return toastError(e); }
  $('#expiredList').innerHTML = list.map(i => itemRow(i, { pick: true })).join('') || emptyHtml('기한이 지난 물건이 없어요', '', 'circle-check');
  $('#bulkBar').classList.toggle('hidden', !list.length);
  updateBulk();
}
function updateBulk() {
  const n = $$('#expiredList .pick:checked').length;
  $('#bulkCount').textContent = n ? `${n}개 선택됨` : '물건을 선택하세요';
  $$('[data-bulk]').forEach(b => (b.disabled = !n));
}
$('#expiredList').addEventListener('change', updateBulk);
$('#selectAll').addEventListener('click', () => {
  const all = $$('#expiredList .pick');
  const on = all.some(c => !c.checked);
  all.forEach(c => (c.checked = on));
  updateBulk();
});
$$('[data-bulk]').forEach(b => b.addEventListener('click', async () => {
  const ids = $$('#expiredList .pick:checked').map(c => +c.value);
  if (!ids.length || !confirm(`${ids.length}개 물건을 ${b.dataset.bulk} 처리할까요?`)) return;
  try {
    await api('/api/admin/items/bulk-dispose', { method: 'POST', body: { ids, type: b.dataset.bulk } });
    toast(`${ids.length}개 ${b.dataset.bulk} 처리했어요`); refresh();
  } catch (err) { toastError(err); }
}));

// =====================================================
// 통계
// =====================================================
$('#month').value = kstToday().slice(0, 7);
$('#month').addEventListener('change', loadStats);
const hbars = rows => {
  const max = Math.max(1, ...rows.map(r => r.count));
  return rows.map(r => `<div class="hbar"><span>${esc(r.label)}</span><div class="track"><div class="fill" style="width:${r.count / max * 100}%"></div></div><b>${r.count}</b></div>`).join('')
    || '<p class="muted small">이 달의 기록이 없어요.</p>';
};
async function loadStats() {
  let s;
  try { s = await api('/api/admin/stats?month=' + $('#month').value); } catch (e) { return toastError(e); }
  const st = s.byStatus;
  const total = Object.values(st).reduce((a, b) => a + b, 0);
  const rate = total ? Math.round((st.returned || 0) / total * 100) : 0;
  const C = 2 * Math.PI * 49;
  $('#tiles').innerHTML = `
    <div class="tile ring-tile">
      <svg class="ring" viewBox="0 0 112 112"><circle class="track" cx="56" cy="56" r="49"/><circle class="bar" cx="56" cy="56" r="49" stroke-dasharray="${C}" stroke-dashoffset="${C}" id="ringBar"/></svg>
      <div><div class="k">${icon('circle-check')}주인 찾은 비율</div><div class="v">${rate}<small>%</small></div><div class="muted small">전체 ${total}개 중 ${st.returned || 0}개</div></div>
    </div>
    <div class="tile"><div class="k">${icon('package')}보관 중</div><div class="v">${(st.stored || 0) + (st.requested || 0)}<small>개</small></div></div>
    <div class="tile"><div class="k">${icon('hand')}대기 중인 신청</div><div class="v">${s.pending.claims}<small>건</small></div></div>
    <div class="tile"><div class="k">${icon('puzzle')}찾는 중인 신고</div><div class="v">${s.pending.reports}<small>건</small></div></div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => { $('#ringBar').style.strokeDashoffset = C * (1 - rate / 100); }));
  $('#byCategory').innerHTML = hbars(s.byCategory);
  $('#byLocation').innerHTML = hbars(s.byLocation);
  const maxM = Math.max(1, ...s.monthly.map(m => m.total));
  $('#monthly').innerHTML = s.monthly.map(m => {
    const kept = m.total - m.returned - m.disposed;
    const h = v => `${v / maxM * 140}px`;
    return `<div class="col"><span class="num">${m.total}</span><div class="stack">
      <div class="seg-a" style="height:${h(m.returned)}"></div><div class="seg-c" style="height:${h(m.disposed)}"></div><div class="seg-b" style="height:${h(kept)}"></div></div>
      <span class="lbl">${+m.month.slice(5)}월</span></div>`;
  }).join('') || '<p class="muted small">아직 기록이 없어요.</p>';
}

// =====================================================
// 설정
// =====================================================
let locs = [];
const renderLocs = () => {
  $('#locChips').innerHTML = locs.map((l, i) => `<span class="ec">${esc(l)}<button type="button" data-rm="${i}" aria-label="삭제">${icon('x')}</button></span>`).join('');
};
async function loadSettings() {
  let s;
  try { s = await api('/api/admin/settings'); } catch (e) { return toastError(e); }
  const f = $('#basicForm');
  f.siteName.value = s.siteName;
  f.schoolName.value = s.schoolName;
  f.deptName.value = s.deptName;
  f.retentionDays.value = s.retentionDays;
  locs = [...s.locations]; renderLocs();
  $('#pwSettings').classList.toggle('hidden', s.authMode !== 'password');
  $('#curCode').textContent = s.studentCode || '없음';
  const d = $('#dropForm');
  d.enabled.checked = s.drop.enabled; d.review.checked = s.drop.review;
  d.meritEnabled.checked = s.drop.meritEnabled; d.meritPoints.value = s.drop.meritPoints;
}
$('#locChips').addEventListener('click', e => {
  const b = e.target.closest('[data-rm]');
  if (b) { locs.splice(+b.dataset.rm, 1); renderLocs(); }
});
const addLoc = () => {
  const v = $('#locInput').value.trim();
  if (v && !locs.includes(v)) { locs.push(v); renderLocs(); }
  $('#locInput').value = '';
  $('#locInput').focus();
};
$('#locAdd').addEventListener('click', addLoc);
$('#locInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addLoc(); } });

$('#basicForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/admin/settings', { method: 'PUT', body: { siteName: f.siteName.value, schoolName: f.schoolName.value, deptName: f.deptName.value, retentionDays: f.retentionDays.value, locations: locs } });
    config.siteName = f.siteName.value; config.schoolName = f.schoolName.value; config.deptName = f.deptName.value; config.locations = [...locs]; config.retentionDays = +f.retentionDays.value;
    fillNames(config);
    renderRegChoices();
    setRetentionHint();
    toast('저장했어요');
  } catch (err) { toastError(err); }
});
$('#codeForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/admin/settings/student-code', { method: 'POST', body: { code: f.code.value, logoutAll: f.logoutAll.checked } });
    f.reset(); toast('입장 코드를 바꿨어요'); loadSettings();
  } catch (err) { toastError(err); }
});
$('#adminPwForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/admin/settings/admin-password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
    f.reset(); toast('관리자 비밀번호를 바꿨어요');
  } catch (err) { toastError(err); }
});
$('#dropQrIcon').innerHTML = icon('qr-code');
$('#dropChev').outerHTML = icon('chevron-right', 'chev');
$('#rotateIcon').innerHTML = icon('refresh-cw');
$('#dropForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/admin/settings/drop', { method: 'POST', body: {
      enabled: f.enabled.checked, review: f.review.checked, meritEnabled: f.meritEnabled.checked, meritPoints: f.meritPoints.value } });
    toast('저장했어요');
  } catch (err) { toastError(err); }
});
$('#rotateDrop').addEventListener('click', async () => {
  if (!confirm('새 QR을 만들까요?\n지금 교무실에 있는 QR 포스터는 더 이상 열리지 않으니 새로 뽑아야 해요.')) return;
  try { await api('/api/admin/settings/drop/rotate', { method: 'POST' }); toast('새 QR을 만들었어요. 포스터를 다시 뽑아 주세요'); }
  catch (err) { toastError(err); }
});
$('#tools').innerHTML = `
  <a class="cell tap" href="/poster" target="_blank" style="color:inherit"><span class="icon-tile" style="background:var(--blue)">${icon('qr-code')}</span>
    <span class="text"><b>QR 포스터 만들기</b><small>복도·${esc(config.deptName)} 앞에 붙일 A4 포스터</small></span>${icon('chevron-right', 'chev')}</a>
  <a class="cell tap" href="/api/admin/export.xlsx" style="color:inherit"><span class="icon-tile" style="background:var(--green)">${icon('download')}</span>
    <span class="text"><b>엑셀 파일 내려받기</b><small>물품 전체 · 학생 등록·상점 · 수령 신청 · 분실 신고</small></span>${icon('chevron-right', 'chev')}</a>
  <a class="cell tap" href="/manual.pdf" download="찾아줘-사용설명서.pdf" style="color:inherit"><span class="icon-tile" style="background:#ff3b30">${icon('book-open')}</span>
    <span class="text"><b>사용설명서 (PDF)</b><small>선생님용 사용 안내 · 인쇄하거나 새로 오신 선생님께 전달</small></span>${icon('chevron-right', 'chev')}</a>
  <a class="cell tap" href="/today" target="_blank" style="color:inherit"><span class="icon-tile" style="background:#5856d6">${icon('tv')}</span>
    <span class="text"><b>오늘의 분실물 (TV 화면)</b><small>조회 시간·복도 모니터에 띄우기</small></span>${icon('chevron-right', 'chev')}</a>
  <div class="cell"><span class="icon-tile" style="background:#8e8e93">${icon('smartphone')}</span>
    <span class="text"><b>홈 화면에 추가</b><small>아이폰: 공유 → 홈 화면에 추가 · 안드로이드: ⋮ → 홈 화면에 추가</small></span></div>`;

// =====================================================
// 공통
// =====================================================
let current = 'register';
const loaders = { drops: loadDrops, items: loadItems, claims: loadClaims, match: loadReports, expired: loadExpired, stats: loadStats, settings: loadSettings };
const counts = { claims: 0, reports: 0, expired: 0, drops: 0, more: 0 };
async function updateCounts() {
  try {
    const [st, expired] = await Promise.all([api('/api/admin/stats'), api('/api/admin/expired')]);
    Object.assign(counts, { claims: st.pending.claims, reports: st.pending.reports, expired: expired.length, drops: st.pending.drops_todo });
    counts.more = counts.expired + counts.drops;
    $$('[data-count]').forEach(el => {
      const n = counts[el.dataset.count];
      el.textContent = n; el.classList.toggle('hidden', !n); el.classList.add('alert');
    });
  } catch { /* 배지는 실패해도 무시 */ }
}

// 더보기 시트 (휴대폰)
$('#moreBtn').addEventListener('click', () => {
  const tile = (attr, ic, color, label, badge = 0) => `<button ${attr}><span class="tile-ic" style="background:${color}">${icon(ic)}</span>${label}${badge ? `<span class="badge-dot">${badge}</span>` : ''}</button>`;
  const sheet = openSheet({
    title: '더보기',
    body: `<div class="more-grid">
      ${tile('data-go="drops"', 'scan-line', '#ff9500', '학생 등록', counts.drops)}
      ${tile('data-go="expired"', 'hourglass', 'var(--orange)', '처리 대상', counts.expired)}
      ${tile('data-go="stats"', 'chart-column', 'var(--green)', '통계')}
      ${tile('data-go="settings"', 'settings', '#8e8e93', '설정')}
      ${tile('data-href="/"', 'smartphone', 'var(--blue)', '학생 화면')}
      ${tile('data-href="/today"', 'tv', '#5856d6', 'TV 화면')}
      ${tile('data-href="/poster"', 'qr-code', '#ff2d55', 'QR 포스터')}
      ${isStandalone() ? '' : tile('data-install', 'download', '#34c759', '앱 설치')}
    </div>`,
  });
  sheet.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.go) { sheet.close(); location.hash = '#' + b.dataset.go; }
    else if (b.dataset.href) location.href = b.dataset.href;
    else if ('install' in b.dataset) { sheet.close(); installApp(); }
  });
});

function refresh() { return Promise.all([loaders[current]?.(), updateCounts()]); }
setupTabs(name => {
  current = name;
  $('#moreBtn').classList.toggle('on', MORE_TABS.includes(name));
  refresh();
});
pullToRefresh(refresh);
