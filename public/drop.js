import { $, $$, esc, icon, toast, toastError, openSheet, successMark, catIcon, options, fillNames } from '/common.js';
import { photoEditor } from '/photo-editor.js';

// 사무실에 둔 QR 주소: /drop?k=키  (비밀번호 없이 등록)
const k = new URLSearchParams(location.search).get('k') || '';
$('#logo').innerHTML = icon('search');
$('#camIcon').innerHTML = icon('camera');
$('#warnIcon').outerHTML = icon('circle-alert');
$('#mosaicHint').innerHTML = `${icon('hand')}가릴 곳을 드래그하면 모자이크돼요`;
$('#undo').innerHTML = `${icon('undo-2')}되돌리기`;
$('#repick').innerHTML = `${icon('camera')}다시 찍기`;
$('#aiBtn').innerHTML = `${icon('sparkles')}AI로 채우기`;

const store = {
  get: key => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, v) => { try { localStorage.setItem(key, v); } catch { /* 무시 */ } },
};

async function call(path, opts = {}) {
  let res;
  try { res = await fetch(path, opts); } catch { throw new Error('인터넷 연결을 확인해 주세요'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `요청 실패 (${res.status})`), { status: res.status });
  return data;
}

let cfg;
try {
  cfg = await call('/api/drop/config?k=' + encodeURIComponent(k));
} catch (e) {
  $('#blocked').innerHTML = `<div class="error-page">${icon('qr-code')}<h2>${esc(e.message)}</h2>
    <p class="muted">주운 물건은 교무실 선생님께 직접 전달해 주셔도 돼요.</p></div>`;
  $('#blocked').classList.remove('hidden');
  throw e;
}
fillNames(cfg);
document.title = `주운 물건 등록 · ${cfg.siteName}`;
$('#formWrap').classList.remove('hidden');

if (cfg.merit) {
  $('#meritBanner').innerHTML = `<div class="merit-banner"><span class="big">🏅</span><div><b>상점 ${cfg.merit.points}점을 받을 수 있어요</b>
    <span class="muted small">선생님이 물건을 확인한 뒤 부여해요.</span></div></div>`;
}
$('#privacyNote').textContent = `학번과 이름은 ${cfg.deptName} 선생님만 볼 수 있어요.${cfg.merit ? ' 상점 부여에 쓰여요.' : ''}`;

const chips = (name, list, ic = () => '') => list.map(v =>
  `<label><input type="radio" name="${name}" value="${esc(v)}" required><span>${ic(v)}${esc(v)}</span></label>`).join('');
$('#fCategory').innerHTML = chips('category', cfg.categories, c => catIcon(c));
$('#fLocation').innerHTML = chips('location', cfg.locations);
$('#fColor').innerHTML = options(cfg.colors, '', '선택 안 함');

// 이 기기에서 전에 입력한 학번·이름 기억
const form = $('#dropForm');
form.finder_no.value = store.get('finderNo') || '';
form.finder_name.value = store.get('finderName') || '';

// ---------- 사진 ----------
const editor = photoEditor($('#canvas'), { onDragStart: () => $('#mosaicHint').classList.add('hidden') });
$('#pick').addEventListener('click', () => $('#file').click());
$('#repick').addEventListener('click', () => $('#file').click());
$('#undo').addEventListener('click', () => editor.undo());
$('#file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try { await editor.load(file); } catch { return toast('이 사진 형식은 열 수 없어요.', { error: true }); }
  $('#editorWrap').classList.remove('hidden');
  $('#pick').classList.add('hidden');
  e.target.value = '';
  if (cfg.aiEnabled) { $('#aiBtn').classList.remove('hidden'); runAi(); }
});

async function runAi() {
  const btn = $('#aiBtn');
  btn.disabled = true; btn.classList.add('loading'); btn.innerHTML = `${icon('sparkles')}분석 중…`;
  try {
    const r = await call('/api/drop/ai-tag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: editor.toDataUrl(), k }) });
    if (r.category) form.category.value = r.category;
    if (r.color) form.color.value = r.color;
    if (r.description && !form.description.value) form.description.value = r.description;
    $('#sensitive').classList.toggle('hidden', !r.sensitive);
  } catch { /* AI가 안 되면 직접 고르면 됨 */ }
  finally { btn.disabled = false; btn.classList.remove('loading'); btn.innerHTML = `${icon('sparkles')}AI로 채우기`; }
}
$('#aiBtn').addEventListener('click', runAi);

// ---------- 등록 ----------
form.addEventListener('submit', async e => {
  e.preventDefault();
  if (!editor.hasPhoto && !confirm('사진 없이 등록할까요? 사진이 있으면 주인이 훨씬 빨리 찾아요.')) return;
  const fd = new FormData(form);
  fd.append('k', k);
  if (cfg.valuableCategories.includes(fd.get('category'))) fd.append('valuable', '1');
  if (editor.hasPhoto) fd.append('photo', await editor.toBlob(), 'photo.jpg');
  const btn = $('#dropSubmit');
  btn.disabled = true; btn.textContent = '등록 중…';
  try {
    const r = await call('/api/drop/items', { method: 'POST', body: fd });
    store.set('finderNo', fd.get('finder_no'));
    store.set('finderName', fd.get('finder_name'));
    navigator.vibrate?.(15);
    const sheet = openSheet({
      body: `<div class="success">${successMark()}
        <h2 style="margin-top:16px">고마워요, ${esc(fd.get('finder_name'))}님!</h2>
        <p class="muted" style="margin:6px 0 0">등록번호</p>
        <p class="tnum" style="font-size:40px;font-weight:700;margin:0;letter-spacing:-0.02em">${esc(r.reg_no)}</p>
        <p class="muted">물건을 <b>${esc(cfg.deptName)} 선생님</b>께 전달해 주세요.${r.review ? '<br>선생님이 확인하면 사이트에 올라가요.' : ''}</p></div>
        ${r.merit ? `<div class="merit-banner"><span class="big">🏅</span><div><b>상점 ${r.merit.points}점 대상이에요</b><span class="muted small">선생님 확인 후 부여돼요.</span></div></div>` : ''}
        <div class="foot"><button class="btn" id="finish">종료하기</button><button class="btn primary" data-close>하나 더 등록하기</button></div>`,
    });
    $('#finish', sheet).addEventListener('click', () => { sheet.close(); finish(fd.get('finder_name')); });
    form.reset();
    form.finder_no.value = store.get('finderNo') || '';
    form.finder_name.value = store.get('finderName') || '';
    editor.reset();
    $('#editorWrap').classList.add('hidden');
    $('#pick').classList.remove('hidden');
    $('#mosaicHint').classList.remove('hidden');
    $('#sensitive').classList.add('hidden');
    scrollTo({ top: 0 });
  } catch (err) { toastError(err); }
  finally { btn.disabled = false; btn.textContent = '등록하기'; }
});

// 종료하기: 이 기기에 기억한 학번·이름을 지우고 마침 화면 (교무실 공용 태블릿이어도 다음 학생에게 안 보이게)
function finish(name) {
  try { localStorage.removeItem('finderNo'); localStorage.removeItem('finderName'); } catch { /* 무시 */ }
  $('#formWrap').classList.add('hidden');
  $('#blocked').innerHTML = `<div class="error-page">
    <div class="success">${successMark()}</div>
    <h2 style="margin-top:18px">${name ? `${esc(name)}님, ` : ''}등록을 마쳤어요</h2>
    <p class="muted">주인을 찾아 줘서 고마워요!<br>이제 이 화면을 닫아도 돼요.</p>
    <button class="btn" id="again" style="margin-top:20px">다른 물건 등록하기</button></div>`;
  $('#blocked').classList.remove('hidden');
  scrollTo({ top: 0 });
  $('#again').addEventListener('click', () => location.reload());
  // QR로 연 창이면 닫히지 않는 경우가 많아서, 닫기를 시도만 함
  setTimeout(() => { try { window.close(); } catch { /* 무시 */ } }, 1500);
}
