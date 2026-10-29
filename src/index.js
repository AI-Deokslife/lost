import { CATEGORIES, LOCATIONS, COLORS, VALUABLE_CATEGORIES, STATUS_LABELS } from './config.js';
import {
  verifyGoogleIdToken, readSession, sessionCookie, clearSessionCookie, isAllowedEmail, authMode, safeEqual,
  hashPassword, verifyPassword,
} from './auth.js';
import { aiTag } from './ai.js';
import { buildXlsx } from './xlsx.js';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

// ---------- 날짜(한국 시간 기준) ----------
const DAY = 86400_000;
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const diffDays = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

// ---------- 입력 검증 ----------
async function readJson(request) {
  try { return await request.json(); } catch { fail(400, '잘못된 요청 형식입니다.'); }
}
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const required = (v, name, max) => { const s = str(v, max); if (!s) fail(400, `${name}을(를) 입력하세요.`); return s; };
const oneOf = (v, list, name, optional = false) => {
  if (optional && !v) return null;
  if (!list.includes(v)) fail(400, `${name} 값이 올바르지 않습니다.`);
  return v;
};
const dateOrToday = v => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : kstToday());

// ---------- 설정 (D1 settings 테이블이 환경 변수보다 우선) ----------
let settingsCache = null;
let settingsAt = 0;

// 이미 배포된 DB에 새 칸(학생 등록·상점)을 자동으로 추가
const ITEM_COLUMNS = {
  source: "TEXT NOT NULL DEFAULT 'admin'", // admin(선생님 등록) | student(학생 직접 등록)
  finder_no: 'TEXT', finder_name: 'TEXT', // 주운 학생
  reviewed: 'INTEGER NOT NULL DEFAULT 1', // 0이면 선생님 확인 전(학생에게 안 보임)
  merit: 'TEXT', merit_at: 'TEXT', // 상점: pending(대상) | given(부여) | none(제외)
};
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  const { results } = await env.DB.prepare('PRAGMA table_info(items)').all();
  const have = new Set(results.map(r => r.name));
  for (const [col, def] of Object.entries(ITEM_COLUMNS)) {
    if (have.has(col)) continue;
    try { await env.DB.prepare(`ALTER TABLE items ADD COLUMN ${col} ${def}`).run(); }
    catch (e) { if (!/duplicate column/i.test(String(e.message))) throw e; }
  }
  schemaReady = true;
}

async function loadSettings(env) {
  if (settingsCache && Date.now() - settingsAt < 10_000) return settingsCache;
  let rows = [];
  try {
    ({ results: rows } = await env.DB.prepare('SELECT key, value FROM settings').all());
  } catch (e) {
    if (!/no such table/i.test(String(e.message))) throw e;
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)').run();
  }
  settingsCache = Object.fromEntries(rows.map(r => [r.key, r.value]));
  settingsAt = Date.now();
  return settingsCache;
}

async function saveSettings(env, values) {
  await env.DB.batch(Object.entries(values).map(([k, v]) => env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, String(v))));
  settingsCache = null;
}

function buildCfg(env, s) {
  let locations = LOCATIONS;
  try { if (s.locations) locations = JSON.parse(s.locations); } catch { /* 기본값 사용 */ }
  return {
    siteName: s.site_name || env.SITE_NAME || '찾아줘',
    schoolName: s.school_name || env.SCHOOL_NAME || '우리 학교',
    deptName: s.dept_name || env.DEPT_NAME || '학생부',
    retentionDays: parseInt(s.retention_days || env.RETENTION_DAYS || '30', 10) || 30,
    locations,
    studentCode: s.student_code ?? env.STUDENT_CODE ?? '',
    adminHash: s.admin_password_hash || null,
    studentEpoch: s.student_epoch || '0',
    adminEpoch: s.admin_epoch || '0',
    // 학생 직접 등록 (사무실 QR)
    dropEnabled: s.drop_enabled !== '0',
    dropToken: s.drop_token || '',
    dropReview: s.drop_review !== '0',
    meritEnabled: s.merit_enabled === '1',
    meritPoints: parseInt(s.merit_points || '1', 10) || 1,
  };
}

// ---------- 라우터 ----------
const routes = [];
const route = (method, path, auth, handler) => routes.push({
  method, auth, handler,
  re: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'),
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        const origin = request.headers.get('origin');
        if (origin && origin !== url.origin) fail(403, '허용되지 않은 요청입니다.');
      }
      for (const r of routes) {
        if (r.method !== request.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        await ensureSchema(env);
        const cfg = buildCfg(env, await loadSettings(env));
        const user = await readSession(env, request, cfg);
        if (r.auth !== 'public' && !user) fail(401, '로그인이 필요합니다.');
        if (r.auth === 'admin' && user.role !== 'admin') fail(403, `${cfg.deptName}(관리자)만 사용할 수 있습니다.`);
        return await r.handler({ request, env, url, params: m.groups || {}, user, cfg });
      }
      fail(404, '없는 주소입니다.');
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: '서버 오류가 발생했습니다.' }, 500);
    }
  },
};

// ---------- 공통 변환 ----------
function serializeItem(row, cfg, isAdmin) {
  const deadline = addDays(row.found_date, cfg.retentionDays);
  const item = {
    id: row.id,
    reg_no: row.reg_no,
    category: row.category,
    location: row.location,
    location_detail: row.location_detail,
    color: row.color,
    description: row.description,
    valuable: !!row.valuable,
    found_date: row.found_date,
    status: row.status,
    status_label: STATUS_LABELS[row.status],
    deadline,
    days_left: diffDays(kstToday(), deadline),
    // 귀중품은 학생에게 사진을 보여주지 않음
    has_photo: !!row.photo_key && (isAdmin || !row.valuable),
  };
  if (isAdmin) Object.assign(item, {
    returned_to: row.returned_to,
    returned_at: row.returned_at,
    disposal_type: row.disposal_type,
    disposed_at: row.disposed_at,
    created_by: row.created_by,
    created_at: row.created_at,
    pending_claims: row.pending_claims ?? 0,
    source: row.source || 'admin',
    finder_no: row.finder_no,
    finder_name: row.finder_name,
    reviewed: row.reviewed !== 0,
    merit: row.merit,
    merit_at: row.merit_at,
  });
  return item;
}

async function getItem(env, id) {
  const row = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  if (!row) fail(404, '물품을 찾을 수 없습니다.');
  return row;
}

const ACTIVE = "status IN ('stored','requested')";
// 학생에게 보이는 물건: 보관 중이면서 선생님 확인이 끝난 것
const PUBLIC = "status IN ('stored','requested') AND reviewed = 1";
const PENDING_COUNT = "(SELECT COUNT(*) FROM claims c WHERE c.item_id = items.id AND c.status = 'pending') AS pending_claims";

// ---------- 분실 신고 ↔ 습득물 매칭 ----------
const tokens = s => [...new Set(String(s || '').toLowerCase().split(/[\s,.·/()\-~!?]+/).filter(t => t.length >= 2))];

function matchScore(report, item) {
  let score = 0;
  const reasons = [];
  if (report.category === item.category) { score += 3; reasons.push('품목'); }
  if (report.color && report.color === item.color) { score += 2; reasons.push('색상'); }
  if (report.location && report.location === item.location) { score += 1; reasons.push('장소'); }
  const text = `${item.description || ''} ${item.location_detail || ''}`.toLowerCase();
  const hits = tokens(report.detail).filter(t => text.includes(t)).slice(0, 3);
  if (hits.length) { score += hits.length; reasons.push(`키워드(${hits.join(', ')})`); }
  // 잃어버리기 전에 주운 물건은 후보에서 크게 감점
  if (report.lost_date && item.found_date < addDays(report.lost_date, -1)) score -= 4;
  return { score, reasons };
}

const candidatesFor = (report, items, cfg, isAdmin, min = 4, limit = 5) => items
  .map(i => ({ item: serializeItem(i, cfg, isAdmin), ...matchScore(report, i) }))
  .filter(c => c.score >= min)
  .sort((a, b) => b.score - a.score)
  .slice(0, limit);

// ================= 공개 / 인증 =================
// 학생 기기 ID (로그아웃해도 지우지 않는 별도 쿠키, 2년)
const DEVICE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const deviceId = request => {
  const v = (request.headers.get('cookie') || '').split(/;\s*/).find(c => c.startsWith('lf_did='))?.slice(7);
  return v && DEVICE_RE.test(v) ? v : null;
};
const deviceCookie = did => `lf_did=${did}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${2 * 365 * 86400}`;
route('GET', '/api/config', 'public', ({ env, cfg }) => json({
  siteName: cfg.siteName,
  schoolName: cfg.schoolName,
  deptName: cfg.deptName,
  authMode: authMode(env),
  googleClientId: env.GOOGLE_CLIENT_ID,
  allowedDomains: String(env.ALLOWED_DOMAINS || '').split(',').map(s => s.trim()).filter(Boolean),
  devLogin: env.DEV_LOGIN === 'true',
  retentionDays: cfg.retentionDays,
  categories: CATEGORIES, locations: cfg.locations, colors: COLORS,
  valuableCategories: VALUABLE_CATEGORIES, statusLabels: STATUS_LABELS,
  aiEnabled: !!env.AI,
}));

// 홈 화면에 추가할 때 쓰는 앱 정보 (사이트 이름을 바꾸면 함께 바뀜)
route('GET', '/api/manifest', 'public', ({ cfg }) => new Response(JSON.stringify({
  name: `${cfg.siteName} · ${cfg.schoolName} 분실물`,
  short_name: cfg.siteName,
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#f5f7fb',
  theme_color: '#f5f7fb',
  lang: 'ko',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}), { headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=300' } }));

// 간편 모드: 학생 입장 코드 / 관리자 비밀번호
route('POST', '/api/auth/password', 'public', async ({ request, env, cfg }) => {
  if (authMode(env) !== 'password') fail(404, '없는 주소입니다.');
  const code = str((await readJson(request)).code, 100);
  const isAdmin = cfg.adminHash ? await verifyPassword(code, cfg.adminHash) : !!env.ADMIN_PASSWORD && safeEqual(code, env.ADMIN_PASSWORD);
  if (code && isAdmin) {
    const cookie = await sessionCookie(env, { email: 'admin', name: cfg.deptName, role: 'admin', epoch: cfg.adminEpoch });
    return json({ ok: true, role: 'admin' }, 200, { 'set-cookie': cookie });
  }
  if (code && cfg.studentCode && safeEqual(code, cfg.studentCode)) {
    // 기기 ID는 로그아웃해도 남겨 두어, 다시 들어오면 '내 신청' 내역이 그대로 보이게
    const did = deviceId(request) || crypto.randomUUID();
    const cookie = await sessionCookie(env, { email: `student-${did}`, name: '학생', role: 'student', epoch: cfg.studentEpoch }, 180);
    const res = json({ ok: true, role: 'student' });
    res.headers.append('set-cookie', cookie);
    res.headers.append('set-cookie', deviceCookie(did));
    return res;
  }
  await new Promise(r => setTimeout(r, 800)); // 무차별 대입 지연
  fail(401, '코드가 맞지 않아요.');
});

route('POST', '/api/auth/google', 'public', async ({ request, env }) => {
  if (authMode(env) !== 'google') fail(404, '없는 주소입니다.');
  const { credential } = await readJson(request);
  let payload;
  try { payload = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID); }
  catch (e) { fail(401, `로그인 확인 실패: ${e.message}`); }
  if (!isAllowedEmail(env, payload.email)) fail(403, '학교 계정으로만 로그인할 수 있습니다.');
  return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(env, { email: payload.email, name: payload.name || payload.email }) });
});

route('POST', '/api/auth/dev', 'public', async ({ request, env }) => {
  if (env.DEV_LOGIN !== 'true' || authMode(env) !== 'google') fail(404, '없는 주소입니다.');
  const { email } = await readJson(request);
  if (!/^[^@\s]+@[^@\s]+$/.test(email || '')) fail(400, '이메일 형식이 아닙니다.');
  if (!isAllowedEmail(env, email)) fail(403, '허용되지 않은 도메인입니다.');
  return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(env, { email, name: email.split('@')[0] }) });
});

route('POST', '/api/auth/logout', 'public', () => json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() }));

route('GET', '/api/me', 'user', ({ request, user }) => {
  // 이미 로그인해 있던 학생 기기에도 기기 ID를 남겨 둠 (이 업데이트 전에 로그인한 경우)
  const did = user.role === 'student' ? user.email.replace(/^student-/, '') : null;
  if (did && deviceId(request) !== did && DEVICE_RE.test(did)) return json(user, 200, { 'set-cookie': deviceCookie(did) });
  return json(user);
});

// ================= 학생 =================
route('GET', '/api/items', 'user', async ({ env, user, cfg }) => {
  const { results } = await env.DB.prepare(`SELECT * FROM items WHERE ${user.role === 'admin' ? ACTIVE : PUBLIC} ORDER BY found_date DESC, id DESC`).all();
  return json(results.map(r => serializeItem(r, cfg, user.role === 'admin')));
});

route('GET', '/api/today', 'user', async ({ env, cfg }) => {
  let { results } = await env.DB.prepare(
    `SELECT * FROM items WHERE ${PUBLIC} AND created_at >= datetime('now','-1 day') ORDER BY id DESC`).all();
  let range = 'today';
  if (!results.length) {
    ({ results } = await env.DB.prepare(
      `SELECT * FROM items WHERE ${PUBLIC} AND created_at >= datetime('now','-7 day') ORDER BY id DESC`).all());
    range = 'recent';
  }
  return json({ range, items: results.map(r => serializeItem(r, cfg, false)) });
});

route('GET', '/api/photo/:id', 'user', async ({ env, params, user }) => {
  const row = await getItem(env, params.id);
  if (!row.photo_key) fail(404, '사진이 없습니다.');
  if (user.role !== 'admin' && row.reviewed === 0) fail(404, '사진이 없습니다.');
  if (row.valuable && user.role !== 'admin') fail(403, '귀중품 사진은 공개되지 않습니다.');
  const photo = await env.DB.prepare('SELECT data, content_type FROM photos WHERE item_id = ?').bind(row.id).first();
  if (!photo) fail(404, '사진이 없습니다.');
  return new Response(new Uint8Array(photo.data), {
    // 귀중품 사진은 기기에 저장하지 않음 (같은 기기를 학생이 쓸 수도 있으므로)
    headers: { 'content-type': photo.content_type || 'image/jpeg', 'cache-control': row.valuable ? 'no-store' : 'private, max-age=86400' },
  });
});

route('POST', '/api/items/:id/claim', 'user', async ({ request, env, params, user, cfg }) => {
  const b = await readJson(request);
  const studentNo = required(b.student_no, '학번', 20);
  const studentName = required(b.student_name, '이름', 30);
  const detail = required(b.detail, '물건 특징', 500);
  const item = await getItem(env, params.id);
  if (!['stored', 'requested'].includes(item.status) || item.reviewed === 0) fail(409, '이미 처리된 물품입니다.');
  const dup = await env.DB.prepare("SELECT id FROM claims WHERE item_id = ? AND email = ? AND status = 'pending'")
    .bind(item.id, user.email).first();
  if (dup) fail(409, `이미 이 물품에 신청했어요. ${cfg.deptName} 확인을 기다려 주세요.`);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO claims (item_id, email, student_no, student_name, detail) VALUES (?,?,?,?,?)')
      .bind(item.id, user.email, studentNo, studentName, detail),
    env.DB.prepare("UPDATE items SET status = 'requested' WHERE id = ? AND status = 'stored'").bind(item.id),
  ]);
  return json({ ok: true, reg_no: item.reg_no });
});

route('GET', '/api/my', 'user', async ({ env, user, cfg }) => {
  const [claims, reports, items] = await env.DB.batch([
    env.DB.prepare(`SELECT c.*, i.reg_no, i.category, i.description AS item_description, i.status AS item_status
                    FROM claims c JOIN items i ON i.id = c.item_id WHERE c.email = ? ORDER BY c.id DESC LIMIT 50`).bind(user.email),
    env.DB.prepare('SELECT * FROM lost_reports WHERE email = ? ORDER BY id DESC LIMIT 50').bind(user.email),
    env.DB.prepare(`SELECT * FROM items WHERE ${PUBLIC}`),
  ]);
  // 찾는 중인 신고에는 비슷한 습득물을 학생에게도 바로 보여줌
  return json({
    claims: claims.results,
    reports: reports.results.map(r => ({
      ...r,
      candidates: r.status === 'open' ? candidatesFor(r, items.results, cfg, false, 5, 3) : [],
    })),
  });
});

route('POST', '/api/lost-reports', 'user', async ({ request, env, user, cfg }) => {
  const b = await readJson(request);
  const values = [
    user.email,
    required(b.student_no, '학번', 20),
    required(b.student_name, '이름', 30),
    oneOf(b.category, CATEGORIES, '품목'),
    oneOf(b.color, COLORS, '색상', true),
    oneOf(b.location, cfg.locations, '장소', true),
    dateOrToday(b.lost_date),
    required(b.detail, '물건 설명', 500),
  ];
  await env.DB.prepare(`INSERT INTO lost_reports (email, student_no, student_name, category, color, location, lost_date, detail)
                        VALUES (?,?,?,?,?,?,?,?)`).bind(...values).run();
  return json({ ok: true });
});

route('POST', '/api/lost-reports/:id/close', 'user', async ({ env, params, user }) => {
  const r = await env.DB.prepare("UPDATE lost_reports SET status = 'closed' WHERE id = ? AND email = ?")
    .bind(params.id, user.email).run();
  if (!r.meta.changes) fail(404, '신고를 찾을 수 없습니다.');
  return json({ ok: true });
});

// ================= 관리자: 물품 =================
async function nextRegNo(env) {
  const today = kstToday();
  const prefix = `L-${today.slice(5, 7)}${today.slice(8, 10)}-`;
  const { n } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM items WHERE reg_no LIKE ? AND substr(datetime(created_at, '+9 hours'), 1, 10) = ?")
    .bind(prefix + '%', today).first();
  return prefix + String(n + 1).padStart(2, '0');
}

// 선생님 등록과 학생 직접 등록이 함께 쓰는 물품 저장
async function createItem(env, cfg, form, extra) {
  const category = oneOf(form.get('category'), CATEGORIES, '품목');
  const location = oneOf(form.get('location'), cfg.locations, '장소');
  const color = oneOf(form.get('color') || null, COLORS, '색상', true);
  const photo = form.get('photo');
  const hasPhoto = !!(photo && typeof photo === 'object' && photo.size);
  if (hasPhoto) {
    // 사진은 D1에 함께 저장 (화면에서 1280px JPEG로 줄여서 올라오므로 보통 100~400KB)
    if (photo.size > 1_800_000) fail(413, '사진이 너무 큽니다.');
    if (!/^image\//.test(photo.type)) fail(400, '이미지 파일만 올릴 수 있습니다.');
  }
  const regNo = await nextRegNo(env);
  const row = await env.DB.prepare(
    `INSERT INTO items (reg_no, category, location, location_detail, color, description, valuable, photo_key, found_date, created_by,
                        source, finder_no, finder_name, reviewed, merit)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`).bind(
    regNo, category, location, str(form.get('location_detail'), 60) || null, color,
    str(form.get('description'), 200) || null, form.get('valuable') === '1' ? 1 : 0, hasPhoto ? 'db' : null,
    dateOrToday(form.get('found_date')), extra.createdBy,
    extra.source, extra.finderNo || null, extra.finderName || null, extra.reviewed ? 1 : 0, extra.merit || null).first();
  if (hasPhoto) {
    try {
      await env.DB.prepare('INSERT INTO photos (item_id, data, content_type) VALUES (?,?,?)')
        .bind(row.id, await photo.arrayBuffer(), photo.type).run();
    } catch (e) {
      await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(row.id).run();
      throw e;
    }
  }
  return row;
}

route('POST', '/api/admin/items', 'admin', async ({ request, env, user, cfg }) => {
  const row = await createItem(env, cfg, await request.formData(), { createdBy: user.email, source: 'admin', reviewed: true });
  // 이 물건과 비슷한 분실 신고가 있으면 알려줌
  const { results: reports } = await env.DB.prepare("SELECT * FROM lost_reports WHERE status = 'open'").all();
  const matches = reports.filter(r => matchScore(r, row).score >= 4).length;
  return json({ ...serializeItem(row, cfg, true), matching_reports: matches }, 201);
});

// ================= 학생 직접 등록 (사무실에 둔 QR, 비밀번호 없이) =================
function checkDrop(cfg, k) {
  if (!cfg.dropEnabled) fail(403, '지금은 학생 직접 등록을 받지 않아요. 선생님께 물건을 전달해 주세요.');
  if (!cfg.dropToken || !k || !safeEqual(String(k), cfg.dropToken)) fail(403, 'QR 코드가 바뀌었어요. 교무실에 있는 새 QR을 찍어 주세요.');
}

route('GET', '/api/drop/config', 'public', ({ env, url, cfg }) => {
  checkDrop(cfg, url.searchParams.get('k'));
  return json({
    siteName: cfg.siteName, schoolName: cfg.schoolName, deptName: cfg.deptName,
    categories: CATEGORIES, locations: cfg.locations, colors: COLORS, valuableCategories: VALUABLE_CATEGORIES,
    review: cfg.dropReview, merit: cfg.meritEnabled ? { points: cfg.meritPoints } : null, aiEnabled: !!env.AI,
  });
});

route('POST', '/api/drop/items', 'public', async ({ request, env, cfg }) => {
  const form = await request.formData();
  checkDrop(cfg, form.get('k'));
  const finderNo = required(form.get('finder_no'), '학번', 20);
  const finderName = required(form.get('finder_name'), '이름', 30);
  if (!/^\d{3,10}$/.test(finderNo)) fail(400, '학번은 숫자로 입력해 주세요.');
  const row = await createItem(env, cfg, form, {
    createdBy: `학생 ${finderNo} ${finderName}`, source: 'student', finderNo, finderName,
    reviewed: !cfg.dropReview, merit: cfg.meritEnabled ? 'pending' : null,
  });
  return json({ reg_no: row.reg_no, review: cfg.dropReview, merit: cfg.meritEnabled ? { points: cfg.meritPoints } : null }, 201);
});

route('POST', '/api/drop/ai-tag', 'public', async ({ request, env, cfg }) => {
  const { image, k } = await readJson(request);
  checkDrop(cfg, k);
  if (!env.AI) fail(501, 'AI 기능이 설정되지 않았습니다.');
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image || '') || image.length > 2_000_000) fail(400, '이미지가 올바르지 않습니다.');
  try { return json(await aiTag(env, image)); }
  catch (e) { console.error(e); fail(502, `AI 분석 실패: ${e.message}`); }
});

// 관리자: 학생이 등록한 물건 목록 (확인 대기 / 상점 대상 / 전체)
route('GET', '/api/admin/drops', 'admin', async ({ env, url, cfg }) => {
  const filter = url.searchParams.get('filter') || 'review';
  const where = { review: 'reviewed = 0', public: 'reviewed = 1', merit: "merit = 'pending'", given: "merit = 'given'", all: '1=1' }[filter];
  if (!where) fail(400, '필터 값이 올바르지 않습니다.');
  const { results } = await env.DB.prepare(
    `SELECT *, ${PENDING_COUNT} FROM items WHERE source = 'student' AND ${where} ORDER BY id DESC LIMIT 500`).all();
  return json(results.map(r => serializeItem(r, cfg, true)));
});

route('POST', '/api/admin/drops/bulk', 'admin', async ({ request, env }) => {
  const b = await readJson(request);
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger).slice(0, 200);
  if (!ids.length) fail(400, '선택한 물품이 없습니다.');
  const stmt = {
    approve: id => env.DB.prepare('UPDATE items SET reviewed = 1 WHERE id = ?').bind(id),
    unapprove: id => env.DB.prepare('UPDATE items SET reviewed = 0 WHERE id = ?').bind(id), // 공개 취소
    merit: id => env.DB.prepare("UPDATE items SET merit = 'given', merit_at = ? WHERE id = ? AND merit = 'pending'").bind(kstToday(), id),
    unmerit: id => env.DB.prepare("UPDATE items SET merit = 'pending', merit_at = NULL WHERE id = ? AND merit = 'given'").bind(id), // 상점 부여 취소
    exclude: id => env.DB.prepare("UPDATE items SET merit = 'none', merit_at = NULL WHERE id = ? AND merit = 'pending'").bind(id),
    include: id => env.DB.prepare("UPDATE items SET merit = 'pending', merit_at = NULL WHERE id = ? AND merit = 'none'").bind(id),
  }[b.action];
  if (!stmt) fail(400, '알 수 없는 작업입니다.');
  await env.DB.batch(ids.map(stmt));
  return json({ ok: true, count: ids.length });
});

route('GET', '/api/admin/items', 'admin', async ({ env, url, cfg }) => {
  const status = url.searchParams.get('status') || 'active';
  const where = status === 'active' ? ACTIVE : status === 'all' ? '1=1' : 'status = ?';
  const stmt = env.DB.prepare(`SELECT *, ${PENDING_COUNT} FROM items WHERE ${where} ORDER BY id DESC LIMIT 500`);
  const { results } = await (where === 'status = ?' ? stmt.bind(status) : stmt).all();
  return json(results.map(r => serializeItem(r, cfg, true)));
});

route('PATCH', '/api/admin/items/:id', 'admin', async ({ request, env, params, cfg }) => {
  const b = await readJson(request);
  const item = await getItem(env, params.id);
  const today = kstToday();
  const stmts = [];
  switch (b.action) {
    case 'update': {
      const f = b.fields || {};
      const location = f.location === item.location ? item.location : oneOf(f.location, cfg.locations, '장소');
      stmts.push(env.DB.prepare(
        `UPDATE items SET category=?, location=?, location_detail=?, color=?, description=?, valuable=?, found_date=? WHERE id=?`)
        .bind(oneOf(f.category, CATEGORIES, '품목'), location,
          str(f.location_detail, 60) || null, oneOf(f.color || null, COLORS, '색상', true),
          str(f.description, 200) || null, f.valuable ? 1 : 0, dateOrToday(f.found_date), item.id));
      break;
    }
    case 'return': {
      const to = required(b.returned_to, '받은 학생(학번 이름)', 60);
      stmts.push(
        env.DB.prepare("UPDATE items SET status='returned', returned_to=?, returned_at=? WHERE id=?").bind(to, today, item.id),
        env.DB.prepare("UPDATE claims SET status='rejected', processed_at=datetime('now') WHERE item_id=? AND status='pending'").bind(item.id));
      break;
    }
    case 'dispose': {
      const type = oneOf(b.type, ['폐기', '기부'], '처리 방법');
      stmts.push(env.DB.prepare("UPDATE items SET status='disposed', disposal_type=?, disposed_at=? WHERE id=?").bind(type, today, item.id));
      break;
    }
    case 'approve':
      stmts.push(env.DB.prepare('UPDATE items SET reviewed = 1 WHERE id = ?').bind(item.id));
      break;
    case 'unapprove':
      stmts.push(env.DB.prepare('UPDATE items SET reviewed = 0 WHERE id = ?').bind(item.id));
      break;
    case 'merit': {
      const v = oneOf(b.value, ['pending', 'given', 'none'], '상점 상태');
      stmts.push(env.DB.prepare('UPDATE items SET merit = ?, merit_at = ? WHERE id = ?').bind(v, v === 'given' ? today : null, item.id));
      break;
    }
    case 'restore':
      stmts.push(env.DB.prepare(
        `UPDATE items SET returned_to=NULL, returned_at=NULL, disposal_type=NULL, disposed_at=NULL,
           status = CASE WHEN EXISTS (SELECT 1 FROM claims WHERE item_id = items.id AND status='pending') THEN 'requested' ELSE 'stored' END
         WHERE id=?`).bind(item.id));
      break;
    default:
      fail(400, '알 수 없는 작업입니다.');
  }
  await env.DB.batch(stmts);
  const row = await env.DB.prepare(`SELECT *, ${PENDING_COUNT} FROM items WHERE id = ?`).bind(item.id).first();
  return json(serializeItem(row, cfg, true));
});

route('DELETE', '/api/admin/items/:id', 'admin', async ({ env, params }) => {
  const item = await getItem(env, params.id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM claims WHERE item_id = ?').bind(item.id),
    env.DB.prepare('DELETE FROM photos WHERE item_id = ?').bind(item.id),
    env.DB.prepare('DELETE FROM items WHERE id = ?').bind(item.id),
  ]);
  return json({ ok: true });
});

route('POST', '/api/admin/items/bulk-dispose', 'admin', async ({ request, env }) => {
  const b = await readJson(request);
  const type = oneOf(b.type, ['폐기', '기부'], '처리 방법');
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger).slice(0, 200);
  if (!ids.length) fail(400, '선택한 물품이 없습니다.');
  const today = kstToday();
  await env.DB.batch(ids.map(id => env.DB.prepare(
    `UPDATE items SET status='disposed', disposal_type=?, disposed_at=? WHERE id=? AND ${ACTIVE}`).bind(type, today, id)));
  return json({ ok: true, count: ids.length });
});

route('GET', '/api/admin/expired', 'admin', async ({ env, cfg }) => {
  const { results } = await env.DB.prepare(
    `SELECT *, ${PENDING_COUNT} FROM items WHERE ${ACTIVE} AND date(found_date, '+' || ? || ' days') <= ? ORDER BY found_date`)
    .bind(cfg.retentionDays, kstToday()).all();
  return json(results.map(r => serializeItem(r, cfg, true)));
});

route('POST', '/api/admin/ai-tag', 'admin', async ({ request, env }) => {
  if (!env.AI) fail(501, 'AI 기능이 설정되지 않았습니다.');
  const { image } = await readJson(request);
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image || '') || image.length > 2_000_000) fail(400, '이미지가 올바르지 않습니다.');
  try { return json(await aiTag(env, image)); }
  catch (e) { console.error(e); fail(502, `AI 분석 실패: ${e.message}`); }
});

// 엑셀(.xlsx) 내보내기: 물품 전체 / 학생 등록·상점 / 수령 신청 / 분실 신고
const MERIT_LABEL = { pending: '대상(미부여)', given: '부여 완료', none: '제외' };
const kstTime = t => (t ? new Date(Date.parse(t.replace(' ', 'T') + 'Z') + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') : '');

route('GET', '/api/admin/export.xlsx', 'admin', async ({ env, cfg }) => {
  const [items, claims, reports] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM items ORDER BY id'),
    env.DB.prepare('SELECT c.*, i.reg_no, i.description AS item_description, i.category FROM claims c JOIN items i ON i.id = c.item_id ORDER BY c.id'),
    env.DB.prepare('SELECT * FROM lost_reports ORDER BY id'),
  ]);
  const col = (header, width) => ({ header, width });
  const sheets = [
    {
      name: '물품 전체',
      columns: [col('등록번호', 12), col('등록 방법', 10), col('주운 학생 학번', 13), col('주운 학생 이름', 13), col('품목', 12), col('색상', 8),
        col('특징', 28), col('장소', 12), col('세부 장소', 14), col('습득일', 12), col('보관 기한', 12), col('상태', 10), col('귀중품', 8),
        col('학생 공개', 9), col('받은 학생', 16), col('수령일', 12), col('처리 방법', 10), col('처리일', 12), col('상점', 12), col('상점 부여일', 12), col('등록 시각', 17)],
      rows: items.results.map(r => [r.reg_no, r.source === 'student' ? '학생 직접' : '선생님', r.finder_no, r.finder_name, r.category, r.color,
        r.description, r.location, r.location_detail, r.found_date, addDays(r.found_date, cfg.retentionDays), STATUS_LABELS[r.status],
        r.valuable ? 'O' : '', r.reviewed === 0 ? '확인 대기' : 'O', r.returned_to, r.returned_at, r.disposal_type, r.disposed_at,
        MERIT_LABEL[r.merit] || '', r.merit_at, kstTime(r.created_at)]),
    },
    {
      name: '학생 등록·상점',
      columns: [col('학번', 10), col('이름', 10), col('등록번호', 12), col('물건', 28), col('습득일', 12), col('상점 상태', 12), col('상점', 7), col('부여일', 12), col('물건 상태', 10)],
      rows: items.results.filter(r => r.source === 'student').map(r => [r.finder_no, r.finder_name, r.reg_no, r.description || r.category,
        r.found_date, MERIT_LABEL[r.merit] || '해당 없음', r.merit && r.merit !== 'none' ? cfg.meritPoints : '', r.merit_at, STATUS_LABELS[r.status]]),
    },
    {
      name: '수령 신청',
      columns: [col('신청 시각', 17), col('학번', 10), col('이름', 10), col('등록번호', 12), col('물건', 26), col('근거(특징)', 34), col('결과', 10), col('처리 시각', 17)],
      rows: claims.results.map(c => [kstTime(c.created_at), c.student_no, c.student_name, c.reg_no, c.item_description || c.category, c.detail,
        { pending: '확인 중', approved: '수령 완료', rejected: '반려' }[c.status], kstTime(c.processed_at)]),
    },
    {
      name: '분실 신고',
      columns: [col('신고 시각', 17), col('학번', 10), col('이름', 10), col('품목', 12), col('색상', 8), col('장소', 12), col('분실일', 12), col('설명', 34), col('상태', 10)],
      rows: reports.results.map(r => [kstTime(r.created_at), r.student_no, r.student_name, r.category, r.color, r.location, r.lost_date, r.detail,
        { open: '찾는 중', matched: '연락 완료', closed: '종료' }[r.status]]),
    },
  ];
  return new Response(buildXlsx(sheets), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${cfg.siteName}_분실물_${kstToday()}.xlsx`)}`,
      'cache-control': 'no-store',
    },
  });
});

// ================= 관리자: 수령 신청 =================
route('GET', '/api/admin/claims', 'admin', async ({ env, url }) => {
  const status = oneOf(url.searchParams.get('status') || 'pending', ['pending', 'approved', 'rejected'], '상태');
  const { results } = await env.DB.prepare(
    `SELECT c.*, i.reg_no, i.category, i.location, i.location_detail, i.color, i.description AS item_description,
            i.valuable, i.photo_key IS NOT NULL AS has_photo, i.found_date, i.status AS item_status
     FROM claims c JOIN items i ON i.id = c.item_id WHERE c.status = ? ORDER BY c.id ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 200`)
    .bind(status).all();
  return json(results);
});

async function getPendingClaim(env, id) {
  const claim = await env.DB.prepare('SELECT * FROM claims WHERE id = ?').bind(id).first();
  if (!claim) fail(404, '신청을 찾을 수 없습니다.');
  if (claim.status !== 'pending') fail(409, '이미 처리된 신청입니다.');
  return claim;
}

route('POST', '/api/admin/claims/:id/approve', 'admin', async ({ env, params }) => {
  const c = await getPendingClaim(env, params.id);
  await env.DB.batch([
    env.DB.prepare("UPDATE claims SET status='approved', processed_at=datetime('now') WHERE id=?").bind(c.id),
    env.DB.prepare("UPDATE claims SET status='rejected', processed_at=datetime('now') WHERE item_id=? AND status='pending'").bind(c.item_id),
    env.DB.prepare("UPDATE items SET status='returned', returned_to=?, returned_at=? WHERE id=?")
      .bind(`${c.student_no} ${c.student_name}`, kstToday(), c.item_id),
  ]);
  return json({ ok: true });
});

route('POST', '/api/admin/claims/:id/reject', 'admin', async ({ env, params }) => {
  const c = await getPendingClaim(env, params.id);
  await env.DB.batch([
    env.DB.prepare("UPDATE claims SET status='rejected', processed_at=datetime('now') WHERE id=?").bind(c.id),
    env.DB.prepare(`UPDATE items SET status='stored' WHERE id=? AND status='requested'
                    AND NOT EXISTS (SELECT 1 FROM claims WHERE item_id=? AND status='pending')`).bind(c.item_id, c.item_id),
  ]);
  return json({ ok: true });
});

// ================= 관리자: 분실 신고 매칭 =================
route('GET', '/api/admin/lost-reports', 'admin', async ({ env, url, cfg }) => {
  const status = oneOf(url.searchParams.get('status') || 'open', ['open', 'matched', 'closed'], '상태');
  const [reports, items] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM lost_reports WHERE status = ? ORDER BY id DESC LIMIT 200').bind(status),
    env.DB.prepare(`SELECT * FROM items WHERE ${ACTIVE}`),
  ]);
  return json(reports.results.map(r => ({ ...r, candidates: candidatesFor(r, items.results, cfg, true) })));
});

route('POST', '/api/admin/lost-reports/:id/status', 'admin', async ({ request, env, params }) => {
  const { status } = await readJson(request);
  oneOf(status, ['open', 'matched', 'closed'], '상태');
  await env.DB.prepare('UPDATE lost_reports SET status = ? WHERE id = ?').bind(status, params.id).run();
  return json({ ok: true });
});

// ================= 관리자: 통계 =================
route('GET', '/api/admin/stats', 'admin', async ({ env, url }) => {
  const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : kstToday().slice(0, 7);
  const [monthly, byCategory, byLocation, byStatus, pending] = await env.DB.batch([
    env.DB.prepare(`SELECT substr(found_date,1,7) AS month, COUNT(*) AS total, SUM(status='returned') AS returned,
                    SUM(status='disposed') AS disposed FROM items GROUP BY month ORDER BY month DESC LIMIT 12`),
    env.DB.prepare(`SELECT category AS label, COUNT(*) AS count FROM items WHERE substr(found_date,1,7)=? GROUP BY category ORDER BY count DESC`).bind(month),
    env.DB.prepare(`SELECT location AS label, COUNT(*) AS count FROM items WHERE substr(found_date,1,7)=? GROUP BY location ORDER BY count DESC`).bind(month),
    env.DB.prepare('SELECT status, COUNT(*) AS count FROM items GROUP BY status'),
    env.DB.prepare(`SELECT (SELECT COUNT(*) FROM claims WHERE status='pending') AS claims,
                           (SELECT COUNT(*) FROM lost_reports WHERE status='open') AS reports,
                           (SELECT COUNT(*) FROM items WHERE source='student' AND reviewed=0) AS drops,
                           (SELECT COUNT(*) FROM items WHERE merit='pending') AS merits,
                           (SELECT COUNT(*) FROM items WHERE source='student' AND (reviewed=0 OR merit='pending')) AS drops_todo`),
  ]);
  return json({
    month,
    monthly: monthly.results.reverse(),
    byCategory: byCategory.results,
    byLocation: byLocation.results,
    byStatus: Object.fromEntries(byStatus.results.map(r => [r.status, r.count])),
    pending: pending.results[0],
  });
});

// ================= 관리자: 설정 =================
const newDropToken = () => [...crypto.getRandomValues(new Uint8Array(9))].map(n => 'abcdefghjkmnpqrstuvwxyz23456789'[n % 31]).join('');

route('GET', '/api/admin/settings', 'admin', async ({ env, cfg }) => {
  let token = cfg.dropToken;
  if (!token) { token = newDropToken(); await saveSettings(env, { drop_token: token }); }
  return json({
    authMode: authMode(env),
    siteName: cfg.siteName,
    schoolName: cfg.schoolName,
    deptName: cfg.deptName,
    retentionDays: cfg.retentionDays,
    locations: cfg.locations,
    studentCode: cfg.studentCode,
    drop: { enabled: cfg.dropEnabled, token, review: cfg.dropReview, meritEnabled: cfg.meritEnabled, meritPoints: cfg.meritPoints },
  });
});

route('POST', '/api/admin/settings/drop', 'admin', async ({ request, env }) => {
  const b = await readJson(request);
  const points = parseInt(b.meritPoints, 10);
  if (!(points >= 1 && points <= 10)) fail(400, '상점은 1~10점으로 정해 주세요.');
  await saveSettings(env, {
    drop_enabled: b.enabled ? '1' : '0', drop_review: b.review ? '1' : '0',
    merit_enabled: b.meritEnabled ? '1' : '0', merit_points: points,
  });
  return json({ ok: true });
});

// QR이 밖으로 퍼졌을 때: 새 주소를 만들면 예전 QR은 더 이상 열리지 않음
route('POST', '/api/admin/settings/drop/rotate', 'admin', async ({ env }) => {
  const token = newDropToken();
  await saveSettings(env, { drop_token: token });
  return json({ ok: true, token });
});

route('PUT', '/api/admin/settings', 'admin', async ({ request, env }) => {
  const b = await readJson(request);
  const siteName = required(b.siteName, '사이트 이름', 20);
  const schoolName = required(b.schoolName, '학교 이름', 40);
  const deptName = required(b.deptName, '담당 부서 이름', 20);
  const retentionDays = parseInt(b.retentionDays, 10);
  if (!(retentionDays >= 1 && retentionDays <= 365)) fail(400, '보관 기한은 1~365일로 정해 주세요.');
  const locations = [...new Set((Array.isArray(b.locations) ? b.locations : []).map(s => str(s, 20)).filter(Boolean))].slice(0, 40);
  if (!locations.length) fail(400, '장소를 하나 이상 입력해 주세요.');
  await saveSettings(env, { site_name: siteName, school_name: schoolName, dept_name: deptName, retention_days: retentionDays, locations: JSON.stringify(locations) });
  return json({ ok: true });
});

route('POST', '/api/admin/settings/student-code', 'admin', async ({ request, env, cfg }) => {
  const b = await readJson(request);
  const code = required(b.code, '입장 코드', 40);
  if (code.length < 4) fail(400, '입장 코드는 4자 이상이어야 해요.');
  const values = { student_code: code };
  // 코드가 밖으로 퍼졌을 때: 기존에 들어와 있던 학생 기기 모두 로그아웃
  if (b.logoutAll) values.student_epoch = String(Date.now());
  await saveSettings(env, values);
  return json({ ok: true });
});

route('POST', '/api/admin/settings/admin-password', 'admin', async ({ request, env, cfg }) => {
  const b = await readJson(request);
  const current = str(b.current, 100);
  const ok = cfg.adminHash ? await verifyPassword(current, cfg.adminHash) : !!env.ADMIN_PASSWORD && safeEqual(current, env.ADMIN_PASSWORD);
  if (!ok) fail(400, '현재 비밀번호가 맞지 않아요.');
  const next = str(b.next, 100);
  if (next.length < 8) fail(400, '새 비밀번호는 8자 이상이어야 해요.');
  if (cfg.studentCode && next === cfg.studentCode) fail(400, '학생 입장 코드와 다른 비밀번호를 써 주세요.');
  const epoch = String(Date.now());
  await saveSettings(env, { admin_password_hash: await hashPassword(next), admin_epoch: epoch });
  // 다른 기기의 관리자 로그인은 풀고, 지금 기기는 유지
  const cookie = await sessionCookie(env, { email: 'admin', name: cfg.deptName, role: 'admin', epoch });
  return json({ ok: true }, 200, { 'set-cookie': cookie });
});
