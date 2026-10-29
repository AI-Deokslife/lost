import { icon } from '/icons.js';
export { icon };

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export async function api(path, opts = {}) {
  const o = { ...opts, headers: { ...(opts.headers || {}) } };
  if (o.body && !(o.body instanceof FormData) && typeof o.body !== 'string') {
    o.body = JSON.stringify(o.body);
    o.headers['content-type'] = 'application/json';
  }
  let res;
  try { res = await fetch(path, o); }
  catch {
    toast('인터넷 연결을 확인해 주세요', { error: true });
    throw new Error('인터넷 연결을 확인해 주세요');
  }
  if (res.status === 401 && !path.startsWith('/api/auth')) {
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.hash);
    throw new Error('로그인이 필요합니다.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

export async function boot() {
  const [config, me] = await Promise.all([api('/api/config'), api('/api/me')]);
  document.title = `${config.siteName} · ${config.schoolName}`;
  fillNames(config);
  // 관리자로 로그인했으면 어느 화면에서든 관리 화면으로 바로 돌아갈 수 있게
  if (me.role === 'admin' && !location.pathname.startsWith('/admin')) {
    $$('[data-admin-slot]').forEach(slot => {
      slot.innerHTML = `<a class="btn tinted sm admin-link" href="/admin">${icon('settings')}<span>관리 화면</span></a>`;
      slot.classList.remove('hidden');
    });
  }
  $$('[data-logout]').forEach(el => el.addEventListener('click', e => {
    e.preventDefault();
    logoutModal(me);
  }));
  return { config, me };
}

// 학교 이름·담당 부서 이름 채우기 (부서 이름은 학교마다 다름: 학생부, 생활안전부 …)
export function fillNames(config) {
  $$('[data-site]').forEach(el => (el.textContent = config.siteName));
  $$('[data-school]').forEach(el => (el.textContent = config.schoolName));
  document.querySelector('meta[name=apple-mobile-web-app-title]')?.setAttribute('content', config.siteName);
  $$('[data-dept]').forEach(el => (el.textContent = config.deptName));
  $$('[data-dept-ro]').forEach(el => (el.textContent = withRo(config.deptName)));
}

// 받침에 따라 '로/으로' 붙이기 (ㄹ 받침은 '로')
export function withRo(word) {
  const c = String(word).trim().slice(-1).charCodeAt(0) - 0xac00;
  if (c < 0 || c > 11171) return `${word}(으)로`;
  const jong = c % 28;
  return `${word}${jong === 0 || jong === 8 ? '로' : '으로'}`;
}

// ---------- 로그아웃 확인 팝업 ----------
function logoutModal(me) {
  const isAdmin = me?.role === 'admin';
  const sheet = openSheet({
    body: `<div class="logout-pop">
      <div class="logout-ic">${icon('log-out')}</div>
      <h2>로그아웃할까요?</h2>
      <p class="muted">${isAdmin ? '다시 들어올 때 관리자 비밀번호가 필요해요.' : '다시 들어올 때 입장 코드가 필요해요.<br>같은 휴대폰으로 다시 들어오면 ‘내 신청’ 내역이 그대로 보여요.'}</p>
    </div>
    <div class="foot"><button class="btn" data-close>취소</button><button class="btn destructive-solid" id="doLogout">로그아웃</button></div>`,
  });
  sheet.classList.add('compact');
  $('#doLogout', sheet).addEventListener('click', async e => {
    e.target.disabled = true;
    e.target.textContent = '로그아웃 중…';
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* 이미 끊긴 경우도 로그인 화면으로 */ }
    try { await caches.delete('photos-v1'); } catch { /* 무시 */ }
    location.href = '/login';
  });
}

// ---------- 알림 (상단 알약) ----------
let toastTimer;
// action: { label: '되돌리기', run: () => … } 를 주면 알림 안에 버튼이 생김 (6초 동안)
export function toast(msg, { error = false, action = null } = {}) {
  $('#toast')?.remove();
  const el = document.createElement('div');
  el.id = 'toast';
  el.className = error ? 'err' : '';
  el.innerHTML = `${icon(error ? 'circle-alert' : 'circle-check')}<span>${esc(msg)}</span>${action ? `<button class="toast-act">${esc(action.label)}</button>` : ''}`;
  document.body.append(el);
  if (!error) navigator.vibrate?.(12);
  const hide = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  if (action) $('.toast-act', el).addEventListener('click', () => { clearTimeout(toastTimer); hide(); action.run(); });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, action ? 6000 : 2600);
}
export const toastError = err => toast(err.message || String(err), { error: true });

// ---------- 시트 ----------
export function openSheet({ title = '', body = '', left = '', onClose } = {}) {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
    <div class="sheet-head"><div class="left">${left}</div><h3>${esc(title)}</h3>
      <div class="right"><button class="sheet-close" data-close aria-label="닫기">${icon('x')}</button></div></div>
    <div class="sheet-body">${body}</div></div>`;
  const close = () => {
    if (bg.classList.contains('closing')) return;
    bg.classList.add('closing');
    setTimeout(() => { bg.remove(); document.body.style.overflow = ''; onClose?.(); }, 260);
  };
  bg.close = close;
  bg.setBody = (html, t) => {
    $('.sheet-body', bg).innerHTML = html;
    if (t !== undefined) $('.sheet-head h3', bg).textContent = t;
    $('.sheet', bg).scrollTop = 0;
  };
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  document.body.append(bg);
  enableSwipeClose(bg, close);
  return bg;
}

export const successMark = () => `<svg viewBox="0 0 76 76"><circle cx="38" cy="38" r="38"/><path d="M22 39l11 11 21-23"/></svg>`;

// ---------- 표시용 도우미 ----------
export const CAT_ICON = { '전자기기': 'headphones', '의류': 'shirt', '필통·학용품': 'pencil', '지갑·카드': 'wallet', '물병': 'cup-soda', '기타': 'package' };
export const catIcon = (c, cls = '') => icon(CAT_ICON[c] || 'package', cls);
export const placeText = i => [i.location, i.location_detail].filter(Boolean).join(' ');

export function relDate(d) {
  if (!d) return '';
  // DB의 등록 시각('YYYY-MM-DD HH:MM:SS')은 UTC → 한국 날짜로
  if (d.length > 10) d = new Date(Date.parse(d.replace(' ', 'T') + 'Z') + 9 * 3600_000).toISOString().slice(0, 10);
  const diff = Math.round((Date.parse(kstToday()) - Date.parse(d.slice(0, 10))) / 86400_000);
  if (diff <= 0) return '오늘';
  if (diff === 1) return '어제';
  if (diff < 7) return `${diff}일 전`;
  const [, m, day] = d.slice(0, 10).split('-');
  return `${+m}월 ${+day}일`;
}

export function ddayTag(item) {
  if (!['stored', 'requested'].includes(item.status)) return '';
  if (item.days_left <= 0) return '<span class="tag red">기한 지남</span>';
  if (item.days_left <= 7) return `<span class="tag red">D-${item.days_left}</span>`;
  return '';
}

export function statusTag(item) {
  const cls = { stored: 'blue', requested: 'otint', returned: 'green', disposed: 'gray' }[item.status];
  return `<span class="tag ${cls}">${esc(item.status_label)}</span>`;
}

export function mediaHtml(item, cls = 'media', tags = '') {
  const overlay = tags ? `<div class="tags">${tags}</div>` : '';
  // 사진은 자르지 않고 통째로(contain) 보여주고, 남는 칸은 같은 사진을 흐리게 깔아 채움
  if (item.has_photo) {
    const src = `/api/photo/${item.id}`;
    return `<div class="${cls} has-img"><img class="bg" loading="lazy" src="${src}" alt="" aria-hidden="true"><img class="fg" loading="lazy" src="${src}" alt="">${overlay}</div>`;
  }
  if (item.valuable) return `<div class="${cls}"><div class="ph lock">${icon('lock')}<small>귀중품 · 사진 비공개</small></div>${overlay}</div>`;
  return `<div class="${cls}"><div class="ph">${catIcon(item.category)}<small>사진 없음</small></div>${overlay}</div>`;
}

export const emptyHtml = (title, sub = '', ic = 'inbox') =>
  `<div class="empty">${icon(ic)}<b>${esc(title)}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;

export const skeletonCards = (n = 8) => Array.from({ length: n }, () =>
  `<div class="card sk"><div class="media"><div class="skeleton"></div></div><div class="body">
    <div class="skeleton line" style="width:40%"></div><div class="skeleton line" style="width:85%;height:16px"></div><div class="skeleton line" style="width:60%"></div></div></div>`).join('');

export const options = (list, selected = '', empty = null) =>
  (empty !== null ? `<option value="">${esc(empty)}</option>` : '') +
  list.map(v => `<option ${v === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');

// ---------- 탭 ----------
export function setupTabs(onChange) {
  const buttons = $$('[data-tab]');
  const show = name => {
    $$('.sheet-bg').forEach(sh => sh.close?.());
    buttons.forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $$('main > section').forEach(p => p.classList.toggle('hidden', p.id !== name));
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    onChange?.(name);
  };
  const fromHash = () => (buttons.find(b => '#' + b.dataset.tab === location.hash) || buttons[0]).dataset.tab;
  buttons.forEach(b => b.addEventListener('click', () => { show(b.dataset.tab); window.scrollTo({ top: 0 }); }));
  window.addEventListener('hashchange', () => show(fromHash()));
  show(fromHash());
  return show;
}

// ---------- 시트를 아래로 밀어서 닫기 (휴대폰) ----------
function enableSwipeClose(bg, close) {
  const sheet = $('.sheet', bg);
  let y0 = null, dy = 0;
  sheet.addEventListener('touchstart', e => {
    y0 = sheet.scrollTop <= 0 && !e.target.closest('input, textarea, select, canvas') ? e.touches[0].clientY : null;
    dy = 0;
  }, { passive: true });
  sheet.addEventListener('touchmove', e => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 0) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (y0 === null) return;
    sheet.style.transition = 'transform .3s var(--ease)';
    if (dy > 110) close(); else sheet.style.transform = '';
    y0 = null;
  });
}

// ---------- 당겨서 새로고침 (홈 화면 앱에는 새로고침 버튼이 없으므로) ----------
export function pullToRefresh(onRefresh) {
  if (!matchMedia('(pointer: coarse)').matches) return;
  document.documentElement.classList.add('ptr-on');
  const ind = document.createElement('div');
  ind.className = 'ptr';
  ind.innerHTML = icon('refresh-cw');
  document.body.append(ind);
  let y0 = null, dy = 0, busy = false;
  addEventListener('touchstart', e => {
    y0 = scrollY <= 0 && !busy && !$('.sheet-bg') && !e.target.closest('canvas, .hscroll, .pills') ? e.touches[0].clientY : null;
    dy = 0;
  }, { passive: true });
  addEventListener('touchmove', e => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    const d = Math.min(dy, 120) * 0.6;
    ind.style.transform = `translate(-50%, ${d}px) rotate(${dy * 2.5}deg)`;
    ind.style.opacity = Math.min(1, dy / 80);
  }, { passive: true });
  addEventListener('touchend', async () => {
    if (y0 === null) return;
    const go = dy > 80;
    y0 = null;
    if (go) {
      busy = true; ind.classList.add('spin'); ind.style.transform = 'translate(-50%, 44px)';
      navigator.vibrate?.(10);
      try { await onRefresh(); } finally { busy = false; ind.classList.remove('spin'); }
    }
    ind.style.transform = ''; ind.style.opacity = 0;
  });
}

// ---------- 앱 설치 (홈 화면에 추가) ----------
let installEvent = null;
const installHooks = [];
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; installHooks.forEach(f => f()); });
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 무시 */ } },
};

export async function installApp() {
  if (installEvent) {
    installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    installEvent = null;
    if (outcome === 'accepted') toast('홈 화면에 추가했어요');
    return;
  }
  openSheet({
    title: '홈 화면에 추가',
    body: `<div class="group" style="margin-top:8px">
      ${isIOS()
        ? `<div class="cell"><span class="step-n">1</span><span class="text"><b>아래쪽(또는 위쪽) <span style="color:var(--blue)">${icon('share')} 공유</span> 버튼을 눌러요</b></span></div>
           <div class="cell"><span class="step-n">2</span><span class="text"><b><span style="color:var(--blue)">${icon('square-plus')} 홈 화면에 추가</span>를 눌러요</b><small>안 보이면 메뉴를 위로 올려 보세요</small></span></div>
           <div class="cell"><span class="step-n">3</span><span class="text"><b>오른쪽 위 <span style="color:var(--blue)">추가</span>를 누르면 끝!</b></span></div>`
        : `<div class="cell"><span class="step-n">1</span><span class="text"><b>브라우저 오른쪽 위 ${icon('ellipsis')} 메뉴를 눌러요</b></span></div>
           <div class="cell"><span class="step-n">2</span><span class="text"><b>‘홈 화면에 추가’ 또는 ‘앱 설치’를 눌러요</b></span></div>`}
      </div>
      <p class="muted small" style="text-align:center;margin:16px 0 0">홈 화면 아이콘으로 열면 앱처럼 전체 화면으로 열려요.</p>
      <div class="foot"><button class="btn primary" data-close>알겠어요</button></div>`,
  });
}

// 휴대폰에서만, 아직 설치하지 않았고 닫지 않았을 때 배너 표시
export function installBanner(el) {
  if (!el) return;
  const render = () => {
    const show = !isStandalone() && matchMedia('(pointer: coarse)').matches && !store.get('installDismissed') && (installEvent || isIOS());
    el.classList.toggle('hidden', !show);
    if (!show) return;
    el.innerHTML = `<div class="install">
      <img src="/apple-touch-icon.png" alt="">
      <div class="text"><b>홈 화면에 앱으로 추가</b><small>앱처럼 바로 열려요</small></div>
      <button class="btn primary sm" data-install>추가</button>
      <button class="icon-btn" data-dismiss aria-label="닫기">${icon('x')}</button></div>`;
    $('[data-install]', el).onclick = installApp;
    $('[data-dismiss]', el).onclick = () => { store.set('installDismissed', '1'); el.classList.add('hidden'); };
  };
  installHooks.push(render);
  render();
}

// ---------- 공유 ----------
export async function shareLink({ title, text, url }) {
  try {
    if (navigator.share) { await navigator.share({ title, text, url }); return; }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('링크를 복사했어요');
  } catch (e) {
    if (e.name !== 'AbortError') toast('공유하지 못했어요', { error: true });
  }
}

// ---------- 서비스 워커 등록 ----------
if ('serviceWorker' in navigator && isSecureContext) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
