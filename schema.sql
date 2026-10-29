-- 습득물
CREATE TABLE IF NOT EXISTS items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  reg_no          TEXT NOT NULL,                 -- 등록번호 L-MMDD-NN
  category        TEXT NOT NULL,
  location        TEXT NOT NULL,                 -- 구역(층, 운동장 등)
  location_detail TEXT,                          -- 세부 장소(3-2 교실 등)
  color           TEXT,
  description     TEXT,
  valuable        INTEGER NOT NULL DEFAULT 0,    -- 1이면 학생에게 사진 비공개
  photo_key       TEXT,                          -- 사진이 있으면 'db' (photos 테이블)
  found_date      TEXT NOT NULL,                 -- YYYY-MM-DD
  status          TEXT NOT NULL DEFAULT 'stored',-- stored | requested | returned | disposed
  returned_to     TEXT,
  returned_at     TEXT,
  disposal_type   TEXT,                          -- 폐기 | 기부
  disposed_at     TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status, found_date);
CREATE INDEX IF NOT EXISTS idx_items_reg_no ON items(reg_no);

-- "내 것 같아요" 수령 신청
CREATE TABLE IF NOT EXISTS claims (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  student_no   TEXT NOT NULL,
  student_name TEXT NOT NULL,
  detail       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_claims_item ON claims(item_id, status);
CREATE INDEX IF NOT EXISTS idx_claims_email ON claims(email);

-- 분실 신고(역방향)
CREATE TABLE IF NOT EXISTS lost_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT NOT NULL,
  student_no   TEXT NOT NULL,
  student_name TEXT NOT NULL,
  category     TEXT NOT NULL,
  color        TEXT,
  location     TEXT,
  lost_date    TEXT,
  detail       TEXT,
  status       TEXT NOT NULL DEFAULT 'open',     -- open | matched | closed
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON lost_reports(status);

-- 사진 (모자이크 처리 후 1280px JPEG)
CREATE TABLE IF NOT EXISTS photos (
  item_id      INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  data         BLOB NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg'
);

-- 화면에서 바꾸는 설정 (학교 이름, 보관 기한, 장소 목록, 입장 코드 등)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- (v6) 학생 직접 등록·상점 — 이미 배포된 DB에는 서버가 자동으로 칸을 추가합니다.
-- ALTER TABLE items ADD COLUMN source TEXT NOT NULL DEFAULT 'admin';
-- ALTER TABLE items ADD COLUMN finder_no TEXT;
-- ALTER TABLE items ADD COLUMN finder_name TEXT;
-- ALTER TABLE items ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 1;
-- ALTER TABLE items ADD COLUMN merit TEXT;
-- ALTER TABLE items ADD COLUMN merit_at TEXT;
