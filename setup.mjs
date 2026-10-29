// 분실물 센터 자동 설치: npm run setup
// Cloudflare 로그인 → 데이터베이스 생성 → 테이블 생성 → 배포까지 한 번에 진행합니다.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';

const isWin = process.platform === 'win32';
const DB_NAME = 'lost-and-found';
const CONFIG = 'wrangler.jsonc';

const run = (cmd, args, { capture = false } = {}) => {
  const r = spawnSync(cmd, args, { stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', shell: isWin });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const wrangler = (args, opts) => run('npx', ['wrangler', ...args], opts);
const step = (n, msg) => console.log(`\n\x1b[1m[${n}/6] ${msg}\x1b[0m`);
const stop = msg => { console.error(`\n\x1b[31m✖ ${msg}\x1b[0m\n`); process.exit(1); };

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, def = '') => (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim() || def;

console.log('\n🔎 학교 분실물 센터 설치를 시작합니다.\n');

// 1. 준비
step(1, '필요한 프로그램 설치');
if (!existsSync('node_modules/wrangler')) {
  if (!run('npm', ['install', '--no-audit', '--no-fund']).ok) stop('npm install 에 실패했습니다. 인터넷 연결을 확인하세요.');
}

// 2. Cloudflare 로그인
step(2, 'Cloudflare 로그인');
let who = wrangler(['whoami'], { capture: true });
if (!who.ok || /not authenticated/i.test(who.out)) {
  console.log('브라우저가 열리면 Cloudflare에 로그인하고 [Allow / 허용]을 눌러 주세요.');
  if (!wrangler(['login']).ok) stop('로그인에 실패했습니다. 다시 실행해 주세요.');
  who = wrangler(['whoami'], { capture: true });
}
const accounts = [...new Map([...who.out.matchAll(/│\s*(.+?)\s*│\s*([0-9a-f]{32})\s*│/g)].map(m => [m[2], m[1]])).entries()];
if (accounts.length > 1 && !process.env.CLOUDFLARE_ACCOUNT_ID) {
  accounts.forEach(([id, name], i) => console.log(`  ${i + 1}. ${name} (${id})`));
  const pick = parseInt(await ask('사용할 계정 번호', '1'), 10) - 1;
  process.env.CLOUDFLARE_ACCOUNT_ID = (accounts[pick] || accounts[0])[0];
}
console.log('✔ 로그인 확인');

// 3. 학교 정보
step(3, '학교 정보 입력');
let config = readFileSync(CONFIG, 'utf8');
const currentName = config.match(/"SCHOOL_NAME":\s*"([^"]*)"/)?.[1];
const school = await ask('학교 이름', currentName && !currentName.startsWith('○○') ? currentName : '');
if (!school) stop('학교 이름을 입력해 주세요.');
console.log('\n학생들이 사이트에 들어올 때 쓰는 "입장 코드"입니다. 포스터·게시판에 안내하게 됩니다.');
const studentCode = await ask('학생 입장 코드 (엔터: 기존 값 유지)');
console.log('\n학생부 선생님만 아는 관리자 비밀번호입니다. 8자 이상으로 정해 주세요.');
const adminPw = await ask('관리자 비밀번호 (엔터: 기존 값 유지)');
if (adminPw && adminPw.length < 8) stop('관리자 비밀번호는 8자 이상이어야 합니다.');
if (adminPw && studentCode && adminPw === studentCode) stop('입장 코드와 관리자 비밀번호는 달라야 합니다.');
rl.close();
config = config.replace(/"SCHOOL_NAME":\s*"[^"]*"/, `"SCHOOL_NAME": ${JSON.stringify(school)}`);

// 4. 데이터베이스
step(4, '데이터베이스 준비');
const findDb = () => {
  const r = wrangler(['d1', 'list', '--json'], { capture: true });
  try { return JSON.parse(r.out.slice(r.out.indexOf('['))).find(d => d.name === DB_NAME); } catch { return null; }
};
let db = findDb();
if (!db) {
  if (!wrangler(['d1', 'create', DB_NAME, '--location', 'apac', '--no-update-config']).ok) stop('데이터베이스 생성에 실패했습니다.');
  db = findDb();
}
if (!db) stop('데이터베이스 ID를 찾지 못했습니다.');
config = config.replace(/"database_id":\s*"[^"]*"/, `"database_id": "${db.uuid}"`);
writeFileSync(CONFIG, config);
if (!wrangler(['d1', 'execute', DB_NAME, '--remote', '--file=schema.sql']).ok) stop('테이블 생성에 실패했습니다.');
console.log('✔ 데이터베이스 준비 완료');

// 5. 배포 (비밀값 포함)
step(5, '사이트 배포');
const secrets = {};
const prev = existsSync('.deployed') ? readFileSync('.deployed', 'utf8') : '';
if (!prev) secrets.SESSION_SECRET = randomBytes(32).toString('base64url');
if (studentCode) secrets.STUDENT_CODE = studentCode;
if (adminPw) secrets.ADMIN_PASSWORD = adminPw;
if (!prev && (!studentCode || !adminPw)) stop('처음 설치할 때는 입장 코드와 관리자 비밀번호를 모두 입력해야 합니다.');
const secretFile = '.setup-secrets.json';
writeFileSync(secretFile, JSON.stringify(secrets));
let deploy;
try {
  deploy = wrangler(['deploy', '--secrets-file', secretFile]);
} finally {
  unlinkSync(secretFile);
}
if (!deploy.ok) stop('배포에 실패했습니다. 위 오류 메시지를 확인해 주세요.');
writeFileSync('.deployed', new Date().toISOString());

// 6. 완료
step(6, '완료!');
console.log(`
🎉 설치가 끝났습니다.

  • 사이트 주소: 위에 표시된 https://lost-and-found.○○○.workers.dev 주소
  • 학생: 주소로 들어가서 입장 코드 입력
  • 학생부: 같은 주소에서 관리자 비밀번호 입력 → 자동으로 관리 화면(/admin)
  • 조회·복도 TV: 주소 뒤에 /today

코드를 고친 뒤 다시 올릴 때나 비밀번호를 바꿀 때는 npm run setup 을 다시 실행하면 됩니다.
`);
