const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 카테고리 (사이드바에 표시)
const CATEGORIES = {
  국어: ['문학', '비문학', '문법', '화법과 작문'],
  수학: ['수학Ⅰ', '수학Ⅱ', '확률과 통계', '미적분', '기하'],
  사회: ['한국사', '세계사', '지리', '정치와 법', '경제'],
  과학: ['물리', '화학', '생명과학', '지구과학'],
  영어: ['독해', '문법', '듣기', '어휘'],
  운동: ['체력', '구기', '스트레칭'],
  기타: ['진로', '학습법', '기타'],
};

const db = new DatabaseSync(path.join(DATA_DIR, 'unhostudy.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    salt TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    streak INTEGER NOT NULL DEFAULT 0,
    last_visit TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS lectures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '기타',
    sub TEXT NOT NULL DEFAULT '',
    series TEXT NOT NULL DEFAULT '',
    series_order INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft',
    video TEXT,
    thumb TEXT,
    subtitles TEXT NOT NULL DEFAULT '[]',
    views INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lecture_id INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, lecture_id)
  );
  CREATE TABLE IF NOT EXISTS watched (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lecture_id INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    position REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, lecture_id)
  );
`);
db.exec('PRAGMA foreign_keys = ON');

// ---------- helpers ----------
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const today = () => new Date().toISOString().slice(0, 10);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function getUser(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  return (
    db
      .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?')
      .get(m[1]) || null
  );
}
function auth(req, res, next) {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: '로그인이 필요합니다.' });
  req.user = u;
  next();
}
function publicUser(u) {
  const watching = db.prepare('SELECT COUNT(*) c FROM watched WHERE user_id = ?').get(u.id).c;
  return { id: u.id, username: u.username, name: u.name, streak: u.streak, watching };
}
function touchStreak(u) {
  const t = today();
  if (u.last_visit === t) return u;
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const streak = u.last_visit === y ? u.streak + 1 : 1;
  db.prepare('UPDATE users SET streak = ?, last_visit = ? WHERE id = ?').run(streak, t, u.id);
  return { ...u, streak, last_visit: t };
}
function startSession(res, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
}
const LECTURE_SELECT = `
  SELECT l.id, l.title, l.description, l.category, l.sub, l.series, l.series_order,
         l.status, l.thumb, l.views, l.created_at, l.user_id, u.name AS author
  FROM lectures l JOIN users u ON u.id = l.user_id`;
function card(l) {
  return {
    id: l.id,
    title: l.title,
    category: l.category,
    sub: l.sub,
    series: l.series,
    seriesOrder: l.series_order,
    status: l.status,
    author: l.author,
    views: l.views,
    createdAt: l.created_at,
    thumb: l.thumb ? `/media/${l.thumb}` : null,
  };
}

// ---------- subtitles ----------
function cleanCues(raw) {
  let cues;
  try { cues = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { cues = []; }
  if (!Array.isArray(cues)) return [];
  return cues
    .map((c) => ({ start: Number(c.start), end: Number(c.end), text: String(c.text || '').slice(0, 500) }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start && c.text.trim())
    .sort((a, b) => a.start - b.start)
    .slice(0, 5000);
}
function vttTime(s) {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
}
function toVtt(cues) {
  return (
    'WEBVTT\n\n' +
    cues.map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text.replace(/\n{2,}/g, '\n')}\n`).join('\n')
  );
}

// ---------- upload ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, crypto.randomBytes(12).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const generic = !file.mimetype || file.mimetype === 'application/octet-stream';
    const ok =
      file.fieldname === 'video'
        ? file.mimetype.startsWith('video/') || (generic && ['.mp4', '.webm', '.mov', '.mkv', '.m4v', '.ogv'].includes(ext))
        : file.mimetype.startsWith('image/');
    cb(ok ? null : new Error('지원하지 않는 파일 형식입니다.'), ok);
  },
});
const rm = (f) => f && fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/categories', (req, res) => res.json(CATEGORIES));

// auth
app.post('/api/signup', (req, res) => {
  const { username, name, password } = req.body || {};
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '')) return res.status(400).json({ error: '아이디는 영문/숫자/_ 3~20자입니다.' });
  if (!name || name.length > 20) return res.status(400).json({ error: '이름을 입력해주세요. (20자 이내)' });
  if (!password || password.length < 6) return res.status(400).json({ error: '비밀번호는 6자 이상입니다.' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' });
  const salt = crypto.randomBytes(16).toString('hex');
  const r = db.prepare('INSERT INTO users (username, name, salt, pw_hash) VALUES (?, ?, ?, ?)').run(username, name.trim(), salt, hashPw(password, salt));
  let u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  u = touchStreak(u);
  startSession(res, u.id);
  res.json(publicUser(u));
});
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(password || '', u.salt)), Buffer.from(u.pw_hash));
  if (!ok) return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  const nu = touchStreak(u);
  startSession(res, nu.id);
  res.json(publicUser(nu));
});
app.post('/api/logout', (req, res) => {
  const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
  if (m) db.prepare('DELETE FROM sessions WHERE token = ?').run(m[1]);
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => {
  const u = getUser(req);
  res.json(u ? publicUser(touchStreak(u)) : null);
});
app.put('/api/me', auth, (req, res) => {
  const { name, password } = req.body || {};
  if (name) {
    if (name.length > 20) return res.status(400).json({ error: '이름은 20자 이내입니다.' });
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), req.user.id);
  }
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: '비밀번호는 6자 이상입니다.' });
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('UPDATE users SET salt = ?, pw_hash = ? WHERE id = ?').run(salt, hashPw(password, salt), req.user.id);
  }
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
});

// lecture list (메인 화면)
app.get('/api/lectures', (req, res) => {
  const me = getUser(req);
  const where = [`l.status = 'published'`];
  const args = [];
  const named = {};
  const { q, category, sub, scope } = req.query;
  if (q) {
    where.push(
      `(l.title LIKE @q ESCAPE '\\' OR l.description LIKE @q ESCAPE '\\' OR l.series LIKE @q ESCAPE '\\' OR u.name LIKE @q ESCAPE '\\')`
    );
    named.q = `%${String(q).replace(/[\\%_]/g, '\\$&')}%`;
  }
  if (category) { where.push('l.category = ?'); args.push(String(category)); }
  if (sub) { where.push('l.sub = ?'); args.push(String(sub)); }
  let sql = LECTURE_SELECT;
  if (scope === 'favorites') {
    if (!me) return res.status(401).json({ error: '로그인이 필요합니다.' });
    sql += ' JOIN favorites f ON f.lecture_id = l.id AND f.user_id = ?';
    args.unshift(me.id);
  }
  if (scope === 'mine') {
    if (!me) return res.status(401).json({ error: '로그인이 필요합니다.' });
    where.push('l.user_id = ?');
    args.push(me.id);
  }
  sql += ` WHERE ${where.join(' AND ')} ORDER BY l.created_at DESC, l.id DESC LIMIT 200`;
  res.json(db.prepare(sql).all(named, ...args).map(card));
});

// 내 임시저장 목록
app.get('/api/drafts', auth, (req, res) => {
  res.json(
    db.prepare(`${LECTURE_SELECT} WHERE l.user_id = ? AND l.status = 'draft' ORDER BY l.updated_at DESC`).all(req.user.id).map(card)
  );
});

// 강의 상세 (플레이어)
app.get('/api/lectures/:id', (req, res) => {
  const me = getUser(req);
  const l = db.prepare(`${LECTURE_SELECT} WHERE l.id = ?`).get(req.params.id);
  if (!l || (l.status === 'draft' && (!me || me.id !== l.user_id))) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' });
  const full = db.prepare('SELECT video, subtitles FROM lectures WHERE id = ?').get(l.id);
  const next = l.series
    ? db.prepare(
        `${LECTURE_SELECT} WHERE l.status = 'published' AND l.series = ? AND l.user_id = ? ORDER BY l.series_order, l.id`
      ).all(l.series, l.user_id).map(card)
    : [];
  const author = db.prepare(
    `SELECT u.id, u.name, (SELECT COUNT(*) FROM lectures WHERE user_id = u.id AND status = 'published') AS lectures,
            (SELECT COALESCE(SUM(views), 0) FROM lectures WHERE user_id = u.id AND status = 'published') AS views
     FROM users u WHERE u.id = ?`
  ).get(l.user_id);
  const w = me ? db.prepare('SELECT position FROM watched WHERE user_id = ? AND lecture_id = ?').get(me.id, l.id) : null;
  res.json({
    ...card(l),
    description: l.description,
    video: full.video ? `/media/${full.video}` : null,
    subtitleUrl: `/api/lectures/${l.id}/subtitles.vtt`,
    hasSubtitles: cleanCues(full.subtitles).length > 0,
    cues: me && me.id === l.user_id ? cleanCues(full.subtitles) : undefined,
    series: l.series,
    seriesList: next,
    author: { id: author.id, name: author.name, lectures: author.lectures, views: author.views },
    favorite: !!(me && db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND lecture_id = ?').get(me.id, l.id)),
    position: w ? w.position : 0,
    mine: !!(me && me.id === l.user_id),
  });
});
app.get('/api/lectures/:id/subtitles.vtt', (req, res) => {
  const l = db.prepare('SELECT subtitles, status, user_id FROM lectures WHERE id = ?').get(req.params.id);
  const me = getUser(req);
  if (!l || (l.status === 'draft' && (!me || me.id !== l.user_id))) return res.sendStatus(404);
  res.type('text/vtt; charset=utf-8').send(toVtt(cleanCues(l.subtitles)));
});

// 업로드 / 임시저장 (id 가 있으면 내 강의 수정)
app.post(
  '/api/lectures',
  auth,
  upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]),
  (req, res) => {
    const files = req.files || {};
    const newVideo = files.video?.[0]?.filename;
    const newThumb = files.thumb?.[0]?.filename;
    const cleanup = () => { rm(newVideo); rm(newThumb); };
    try {
      const b = req.body;
      const publish = b.status === 'published';
      const title = String(b.title || '').trim().slice(0, 100);
      const category = CATEGORIES[b.category] ? b.category : '기타';
      const sub = CATEGORIES[category].includes(b.sub) ? b.sub : '';
      const series = String(b.series || '').trim().slice(0, 60);
      const order = Math.max(1, parseInt(b.seriesOrder, 10) || 1);
      const description = String(b.description || '').slice(0, 5000);
      const cues = cleanCues(b.subtitles);

      let existing = null;
      if (b.id) {
        existing = db.prepare('SELECT * FROM lectures WHERE id = ? AND user_id = ?').get(b.id, req.user.id);
        if (!existing) { cleanup(); return res.status(404).json({ error: '수정할 강의를 찾을 수 없습니다.' }); }
      }
      const video = newVideo || existing?.video || null;
      if (publish) {
        if (!title) { cleanup(); return res.status(400).json({ error: '제목을 입력해주세요.' }); }
        if (!video) { cleanup(); return res.status(400).json({ error: '업로드할 동영상 파일을 선택해주세요.' }); }
      }
      const status = existing?.status === 'published' ? 'published' : publish ? 'published' : 'draft';
      const thumb = newThumb || existing?.thumb || null;

      let id;
      if (existing) {
        db.prepare(
          `UPDATE lectures SET title=?, description=?, category=?, sub=?, series=?, series_order=?, status=?,
             video=?, thumb=?, subtitles=?, updated_at=datetime('now') WHERE id=?`
        ).run(title, description, category, sub, series, order, status, video, thumb, JSON.stringify(cues), existing.id);
        if (newVideo) rm(existing.video);
        if (newThumb) rm(existing.thumb);
        id = existing.id;
      } else {
        id = Number(
          db.prepare(
            `INSERT INTO lectures (user_id, title, description, category, sub, series, series_order, status, video, thumb, subtitles)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`
          ).run(req.user.id, title, description, category, sub, series, order, status, video, thumb, JSON.stringify(cues)).lastInsertRowid
        );
      }
      res.json({ id, status });
    } catch (e) {
      cleanup();
      throw e;
    }
  }
);
app.delete('/api/lectures/:id', auth, (req, res) => {
  const l = db.prepare('SELECT * FROM lectures WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!l) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' });
  db.prepare('DELETE FROM lectures WHERE id = ?').run(l.id);
  rm(l.video); rm(l.thumb);
  res.json({ ok: true });
});

// 조회수 / 이어보기 / 즐겨찾기
app.post('/api/lectures/:id/view', (req, res) => {
  db.prepare(`UPDATE lectures SET views = views + 1 WHERE id = ? AND status = 'published'`).run(req.params.id);
  const me = getUser(req);
  if (me) db.prepare(`INSERT OR IGNORE INTO watched (user_id, lecture_id) VALUES (?, ?)`).run(me.id, req.params.id);
  res.json({ ok: true });
});
app.post('/api/lectures/:id/progress', auth, (req, res) => {
  const pos = Math.max(0, Number(req.body?.position) || 0);
  db.prepare(
    `INSERT INTO watched (user_id, lecture_id, position) VALUES (?, ?, ?)
     ON CONFLICT(user_id, lecture_id) DO UPDATE SET position = excluded.position, updated_at = datetime('now')`
  ).run(req.user.id, req.params.id, pos);
  res.json({ ok: true });
});
app.post('/api/lectures/:id/favorite', auth, (req, res) => {
  const on = !!req.body?.on;
  if (on) db.prepare('INSERT OR IGNORE INTO favorites (user_id, lecture_id) VALUES (?, ?)').run(req.user.id, req.params.id);
  else db.prepare('DELETE FROM favorites WHERE user_id = ? AND lecture_id = ?').run(req.user.id, req.params.id);
  res.json({ on });
});

// 미디어 (Range 지원: sendFile)
app.get('/media/:file', (req, res) => {
  const f = path.basename(req.params.file);
  res.sendFile(path.join(UPLOAD_DIR, f), (err) => err && !res.headersSent && res.sendStatus(404));
});

app.get('/favicon.ico', (req, res) => res.sendStatus(204));
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.code === 'LIMIT_FILE_SIZE' ? '파일이 너무 큽니다. (최대 2GB)' : err.message || '서버 오류' });
});

app.listen(PORT, () => console.log(`운호스터디 http://localhost:${PORT}`));
