// 구글 로그인(ID 토큰) 검증과 서명된 세션 쿠키
const enc = new TextEncoder();
const dec = new TextDecoder();
const COOKIE = 'lf_session';
const SESSION_DAYS = 7;

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function bytesToB64url(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const list = v => String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const domainOf = email => email.split('@')[1] || '';

let jwks = { keys: null, until: 0 };
async function googleKeys() {
  if (jwks.keys && Date.now() < jwks.until) return jwks.keys;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new Error('구글 인증 키를 가져오지 못했습니다.');
  jwks = { keys: (await res.json()).keys, until: Date.now() + 3600_000 };
  return jwks.keys;
}

export async function verifyGoogleIdToken(token, clientId) {
  const [h, p, s] = String(token || '').split('.');
  if (!s) throw new Error('잘못된 토큰');
  const header = JSON.parse(dec.decode(b64urlToBytes(h)));
  const payload = JSON.parse(dec.decode(b64urlToBytes(p)));
  const jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('알 수 없는 서명 키');
  const key = await crypto.subtle.importKey(
    'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), enc.encode(`${h}.${p}`));
  if (!ok) throw new Error('서명 불일치');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) throw new Error('발급자 불일치');
  if (payload.aud !== clientId) throw new Error('클라이언트 ID 불일치');
  if (payload.exp * 1000 < Date.now()) throw new Error('만료된 토큰');
  if (!payload.email_verified) throw new Error('이메일 미인증 계정');
  return payload;
}

// 'password'(간편: 입장 코드/관리자 비밀번호) 또는 'google'(학교 구글 계정)
export const authMode = env => (env.AUTH_MODE === 'google' ? 'google' : 'password');

export function safeEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function isAdminEmail(env, email) {
  email = String(email).toLowerCase();
  return list(env.ADMIN_EMAILS).includes(email) || list(env.ADMIN_DOMAINS).includes(domainOf(email));
}

export function isAllowedEmail(env, email) {
  const domains = list(env.ALLOWED_DOMAINS);
  if (isAdminEmail(env, email)) return true;
  return domains.length === 0 || domains.includes(domainOf(String(email).toLowerCase()));
}

async function sign(secret, data) {
  if (!secret) throw new Error('SESSION_SECRET이 설정되지 않았습니다.');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToB64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function sessionCookie(env, { email, name, role, epoch }, days = SESSION_DAYS) {
  const body = bytesToB64url(enc.encode(JSON.stringify({ email, name, role, epoch, exp: Date.now() + days * 86400_000 })));
  const value = `${body}.${await sign(env.SESSION_SECRET, body)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${days * 86400}`;
}

export const clearSessionCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// cfg: 설정값(입장 코드나 비밀번호를 바꾸면 epoch가 올라가 기존 로그인이 풀림)
export async function readSession(env, request, cfg) {
  const raw = (request.headers.get('cookie') || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [body, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!body || !sig) return null;
  const expected = await sign(env.SESSION_SECRET, body);
  if (!safeEqual(expected, sig)) return null;
  const data = JSON.parse(dec.decode(b64urlToBytes(body)));
  if (data.exp < Date.now()) return null;
  if (authMode(env) === 'password') {
    if (!data.role) return null;
    const epoch = data.role === 'admin' ? cfg.adminEpoch : cfg.studentEpoch;
    if ((data.epoch || '0') !== epoch) return null;
    return { email: data.email, name: data.name, role: data.role };
  }
  if (!isAllowedEmail(env, data.email)) return null;
  // 권한은 매 요청마다 설정값으로 다시 판단 (ADMIN_EMAILS 변경 즉시 반영)
  return { email: data.email, name: data.name, role: isAdminEmail(env, data.email) ? 'admin' : 'student' };
}

// 관리자 비밀번호 해시 (PBKDF2-SHA256)
const ITER = 100000;
async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return bytesToB64url(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256));
}
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${bytesToB64url(salt)}$${await pbkdf2(password, salt)}`;
}
export async function verifyPassword(password, stored) {
  const [, , salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  return safeEqual(await pbkdf2(password, b64urlToBytes(salt)), hash);
}
