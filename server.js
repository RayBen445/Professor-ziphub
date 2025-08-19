// ZIPHUB: JSON-DB backend (no .env, no CLI). Author: james
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { v4: uuid } = require('uuid');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data');

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/html', express.static(path.join(__dirname, 'html')));

// ---- JSON helpers ----
const file = (n) => path.join(DATA, n);
function readJSON(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    if (fallback === undefined) fallback = Array.isArray(fallback) ? [] : fallback ?? [];
    writeJSON(name, fallback);
    return fallback;
  }
}
function writeJSON(name, data) {
  fs.writeFileSync(file(name), JSON.stringify(data, null, 2), 'utf8');
}
function ensureDataFiles() {
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
  const defaults = {
    'accounts.json': [],
    'devs.json': [],
    'files.json': [],
    'followers.json': { baseBoost: {}, edges: [] }, // baseBoost[userId] = number; edges: [{followerId, followedId}]
    'likes.json': [],
    'comments.json': [],
    'reports.json': [],
    'verifications.json': { verified: {} }, // verified[userId] = {by:'admin|auto', date}
    'sessions.json': [],
    'activity.json': []
  };
  for (const [n, v] of Object.entries(defaults)) {
    if (!fs.existsSync(file(n))) writeJSON(n, v);
  }
}
ensureDataFiles();

// ---- Bootstrap creator james ----
(function bootstrapJames() {
  const accounts = readJSON('accounts.json', []);
  const devs = readJSON('devs.json', []);
  const followers = readJSON('followers.json', { baseBoost: {}, edges: [] });
  const verifications = readJSON('verifications.json', { verified: {} });

  let james = accounts.find((u) => u.username === 'james');
  if (!james) {
    const id = uuid();
    const hash = bcrypt.hashSync('6033', 10);
    james = {
      id, username: 'james', passwordHash: hash,
      role: 'creator', isDeveloper: true, approved: true,
      createdAt: Date.now(), avatar: '/public/img/logo.svg', displayName: 'James (Creator)'
    };
    accounts.push(james);
    devs.push({
      id: james.id, username: 'james', bio: 'ZIPHUB creator',
      avatar: '/public/img/logo.svg', approved: true, verified: true
    });
    verifications.verified[james.id] = { by: 'bootstrap', date: Date.now(), badge: 'creator' };
    followers.baseBoost[james.id] = 3000; // 3k followers boost
    writeJSON('verifications.json', verifications);
    writeJSON('followers.json', followers);
    writeJSON('devs.json', devs);
    writeJSON('accounts.json', accounts);
  } else {
    // Ensure boosts/verification exist
    const v = readJSON('verifications.json', { verified: {} });
    if (!v.verified[james.id]) {
      v.verified[james.id] = { by: 'bootstrap', date: Date.now(), badge: 'creator' };
      writeJSON('verifications.json', v);
    }
    const f = readJSON('followers.json', { baseBoost: {}, edges: [] });
    if (!f.baseBoost[james.id]) {
      f.baseBoost[james.id] = 3000;
      writeJSON('followers.json', f);
    }
  }
})();

// ---- Session helpers ----
function newSession(userId) {
  const sessions = readJSON('sessions.json', []);
  const token = uuid();
  sessions.push({ token, userId, createdAt: Date.now() });
  writeJSON('sessions.json', sessions);
  return token;
}
function getSession(token) {
  if (!token) return null;
  const sessions = readJSON('sessions.json', []);
  return sessions.find((s) => s.token === token) || null;
}
function destroySession(token) {
  const sessions = readJSON('sessions.json', []);
  const idx = sessions.findIndex((s) => s.token === token);
  if (idx >= 0) {
    sessions.splice(idx, 1);
    writeJSON('sessions.json', sessions);
  }
}
function authMiddleware(req, res, next) {
  const token = req.cookies.token;
  const s = getSession(token);
  if (!s) return res.status(401).json({ ok: false, error: 'Not authenticated' });
  const accounts = readJSON('accounts.json', []);
  const user = accounts.find((u) => u.id === s.userId);
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid session' });
  req.user = user;
  next();
}
function adminOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false });
  if (req.user.username !== 'james' && req.user.role !== 'admin')
    return res.status(403).json({ ok: false, error: 'Admin only' });
  next();
}

// ---- Keep-alive (pingbot support) ----
app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- Auth ----
app.post('/api/auth/register', (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Missing fields' });

  const accounts = readJSON('accounts.json', []);
  if (accounts.find((u) => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(400).json({ ok: false, error: 'Username taken' });

  const id = uuid();
  const passwordHash = bcrypt.hashSync(password, 10);
  const isDeveloper = role === 'developer';
  const approved = !isDeveloper; // devs need admin approval
  const user = {
    id, username, passwordHash,
    role: isDeveloper ? 'developer' : 'user',
    isDeveloper, approved, createdAt: Date.now(),
    avatar: '/public/img/logo.svg', displayName: username
  };
  accounts.push(user);
  writeJSON('accounts.json', accounts);

  // If developer, also create dev profile (pending)
  if (isDeveloper) {
    const devs = readJSON('devs.json', []);
    devs.push({ id, username, bio: '', avatar: '/public/img/logo.svg', approved, verified: false });
    writeJSON('devs.json', devs);
  }

  // Auto-follow james for everyone
  const accountsAll = readJSON('accounts.json', []);
  const james = accountsAll.find((u) => u.username === 'james');
  if (james) {
    const followers = readJSON('followers.json', { baseBoost: {}, edges: [] });
    if (!followers.edges.find((e) => e.followerId === id && e.followedId === james.id)) {
      followers.edges.push({ followerId: id, followedId: james.id, at: Date.now() });
      writeJSON('followers.json', followers);
    }
  }

  // Create session
  const token = newSession(id);
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
  return res.json({ ok: true, user: safeUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Missing fields' });

  const accounts = readJSON('accounts.json', []);
  const user = accounts.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(400).json({ ok: false, error: 'Invalid credentials' });
  if (!bcrypt.compareSync(password, user.passwordHash))
    return res.status(400).json({ ok: false, error: 'Invalid credentials' });

  if (user.isDeveloper && !user.approved) {
    return res.status(403).json({ ok: false, error: 'Developer pending admin approval' });
  }

  const token = newSession(user.id);
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
  return res.json({ ok: true, user: safeUser(user) });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ ok: true, user: safeUser(req.user) });
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  destroySession(req.cookies.token);
  res.clearCookie('token');
  res.json({ ok: true });
});

function safeUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

// ---- Dev (profile & listing) ----
app.post('/api/dev/profile', authMiddleware, (req, res) => {
  if (!req.user.isDeveloper) return res.status(403).json({ ok: false, error: 'Not a developer' });
  const devs = readJSON('devs.json', []);
  const me = devs.find((d) => d.id === req.user.id);
  if (!me) return res.status(404).json({ ok: false });
  const { displayName, bio, avatar } = req.body || {};
  if (displayName) req.user.displayName = displayName;
  if (bio !== undefined) me.bio = (bio + '').slice(0, 500);
  if (avatar) {
    me.avatar = avatar;
    req.user.avatar = avatar;
  }
  // update accounts
  const accounts = readJSON('accounts.json', []);
  const idx = accounts.findIndex((a) => a.id === req.user.id);
  accounts[idx] = req.user;
  writeJSON('accounts.json', accounts);
  // update devs
  const di = devs.findIndex((d) => d.id === req.user.id);
  devs[di] = me;
  writeJSON('devs.json', devs);
  res.json({ ok: true, profile: me, user: safeUser(req.user) });
});

app.get('/api/dev/list', (req, res) => {
  const devs = readJSON('devs.json', []);
  res.json({ ok: true, devs });
});

app.get('/api/dev/:id', (req, res) => {
  const devs = readJSON('devs.json', []);
  const d = devs.find((x) => x.id === req.params.id);
  if (!d) return res.status(404).json({ ok: false });
  const followers = readJSON('followers.json', { baseBoost: {}, edges: [] });
  const count = followers.edges.filter((e) => e.followedId === d.id).length + (followers.baseBoost[d.id] || 0);
  res.json({ ok: true, dev: d, followers: count });
});

// ---- Follow / Like / Comment ----
app.post('/api/follow/:developerId', authMiddleware, (req, res) => {
  const developerId = req.params.developerId;
  if (developerId === req.user.id) return res.json({ ok: true, message: 'Cannot follow yourself' });
  const devs = readJSON('devs.json', []);
  if (!devs.find((d) => d.id === developerId)) return res.status(404).json({ ok: false, error: 'No developer' });

  const followers = readJSON('followers.json', { baseBoost: {}, edges: [] });
  const exists = followers.edges.find((e) => e.followerId === req.user.id && e.followedId === developerId);
  if (exists) return res.json({ ok: true, message: 'Already following' });
  followers.edges.push({ followerId: req.user.id, followedId: developerId, at: Date.now() });
  writeJSON('followers.json', followers);

  // auto-verify if >20 followers
  const count = followers.edges.filter((e) => e.followedId === developerId).length + (followers.baseBoost[developerId] || 0);
  if (count >= 20) {
    const ver = readJSON('verifications.json', { verified: {} });
    if (!ver.verified[developerId]) {
      ver.verified[developerId] = { by: 'auto', date: Date.now(), badge: 'verified' };
      writeJSON('verifications.json', ver);
      const devs2 = readJSON('devs.json', []);
      const di = devs2.findIndex((d) => d.id === developerId);
      if (di >= 0) {
        devs2[di].verified = true;
        writeJSON('devs.json', devs2);
      }
    }
  }
  res.json({ ok: true });
});

app.post('/api/files/upload', authMiddleware, (req, res) => {
  if (!req.user.isDeveloper || !req.user.approved)
    return res.status(403).json({ ok: false, error: 'Developer approval required' });
  const { title, description, zipUrl } = req.body || {};
  if (!title || !description) return res.status(400).json({ ok: false, error: 'Title & description required' });
  const files = readJSON('files.json', []);
  const id = uuid();
  const item = {
    id, ownerId: req.user.id, title: (title+'').slice(0,80),
    description: (description+'').slice(0, 1000),
    zipUrl: zipUrl || '', createdAt: Date.now()
  };
  files.push(item);
  writeJSON('files.json', files);

  // seed likes for james >= 60
  if (req.user.username === 'james') {
    const likes = readJSON('likes.json', []);
    const initial = 60 + Math.floor(Math.random() * 80);
    for (let i = 0; i < initial; i++) {
      likes.push({ userId: 'seed-'+i, fileId: id, at: Date.now() });
    }
    writeJSON('likes.json', likes);
  }

  res.json({ ok: true, file: item });
});

app.get('/api/files/list', (req, res) => {
  const files = readJSON('files.json', []);
  const likes = readJSON('likes.json', []);
  const comments = readJSON('comments.json', []);
  const accounts = readJSON('accounts.json', []);
  const out = files.map((f) => ({
    ...f,
    likes: likes.filter((l) => l.fileId === f.id).length,
    comments: comments.filter((c) => c.fileId === f.id).length,
    owner: safeUser(accounts.find((a) => a.id === f.ownerId) || {})
  }));
  res.json({ ok: true, files: out });
});

app.post('/api/files/like', authMiddleware, (req, res) => {
  const { fileId } = req.body || {};
  const files = readJSON('files.json', []);
  if (!files.find((f) => f.id === fileId)) return res.status(404).json({ ok: false, error: 'No file' });
  const likes = readJSON('likes.json', []);
  if (likes.find((l) => l.fileId === fileId && l.userId === req.user.id))
    return res.json({ ok: true, message: 'Already liked' });
  likes.push({ userId: req.user.id, fileId, at: Date.now() });
  writeJSON('likes.json', likes);
  res.json({ ok: true });
});

app.post('/api/files/comment', authMiddleware, (req, res) => {
  const { fileId, text } = req.body || {};
  if (!text) return res.status(400).json({ ok: false, error: 'Empty comment' });
  const files = readJSON('files.json', []);
  if (!files.find((f) => f.id === fileId)) return res.status(404).json({ ok: false, error: 'No file' });
  const comments = readJSON('comments.json', []);
  comments.push({ id: uuid(), fileId, userId: req.user.id, text: (text+'').slice(0,300), at: Date.now() });
  writeJSON('comments.json', comments);
  res.json({ ok: true });
});

app.post('/api/report', authMiddleware, (req, res) => {
  const { fileId, reason } = req.body || {};
  if (!fileId || !reason) return res.status(400).json({ ok: false, error: 'Missing' });
  const reports = readJSON('reports.json', []);
  reports.push({ id: uuid(), fileId, reason: (reason+'').slice(0,300), by: req.user.id, at: Date.now() });
  writeJSON('reports.json', reports);
  res.json({ ok: true });
});

// ---- Admin controls (james) ----
app.get('/api/admin/stats', authMiddleware, adminOnly, (req, res) => {
  const accounts = readJSON('accounts.json', []);
  const devs = readJSON('devs.json', []);
  const files = readJSON('files.json', []);
  const reports = readJSON('reports.json', []);
  const likes = readJSON('likes.json', []);
  const comments = readJSON('comments.json', []);
  res.json({
    ok: true,
    totals: {
      users: accounts.length,
      developers: devs.length,
      files: files.length,
      reports: reports.length,
      likes: likes.length,
      comments: comments.length
    }
  });
});

app.get('/api/admin/reports', authMiddleware, adminOnly, (req, res) => {
  const reports = readJSON('reports.json', []);
  res.json({ ok: true, reports });
});

app.post('/api/admin/delete-file', authMiddleware, adminOnly, (req, res) => {
  const { fileId } = req.body || {};
  if (!fileId) return res.status(400).json({ ok: false, error: 'Missing fileId' });
  const files = readJSON('files.json', []);
  const idx = files.findIndex((f) => f.id === fileId);
  if (idx < 0) return res.status(404).json({ ok: false });
  files.splice(idx, 1);
  writeJSON('files.json', files);

  // cleanup likes/comments/reports
  for (const n of ['likes.json','comments.json','reports.json']) {
    const arr = readJSON(n, []);
    const filtered = arr.filter((x) => x.fileId !== fileId);
    writeJSON(n, filtered);
  }
  res.json({ ok: true });
});

app.post('/api/admin/approve-dev', authMiddleware, adminOnly, (req, res) => {
  const { devId } = req.body || {};
  const accounts = readJSON('accounts.json', []);
  const a = accounts.find((x) => x.id === devId);
  if (!a) return res.status(404).json({ ok: false });
  a.approved = true;
  writeJSON('accounts.json', accounts);

  const devs = readJSON('devs.json', []);
  const d = devs.find((x) => x.id === devId);
  if (d) { d.approved = true; writeJSON('devs.json', devs); }
  res.json({ ok: true });
});

app.post('/api/admin/verify', authMiddleware, adminOnly, (req, res) => {
  const { devId } = req.body || {};
  const ver = readJSON('verifications.json', { verified: {} });
  ver.verified[devId] = { by: 'admin', date: Date.now(), badge: 'verified' };
  writeJSON('verifications.json', ver);
  const devs = readJSON('devs.json', []);
  const d = devs.find((x) => x.id === devId);
  if (d) { d.verified = true; writeJSON('devs.json', devs); }
  res.json({ ok: true });
});

// Create verified accounts in bulk with custom followers
app.post('/api/admin/create-verified', authMiddleware, adminOnly, (req, res) => {
  const { username, password, followersBoost = 50 } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Missing fields' });

  const accounts = readJSON('accounts.json', []);
  if (accounts.find((u) => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(400).json({ ok: false, error: 'Username taken' });

  const id = uuid();
  const passwordHash = bcrypt.hashSync(password, 10);
  const user = { id, username, passwordHash, role: 'developer', isDeveloper: true, approved: true, createdAt: Date.now(), avatar: '/public/img/logo.svg', displayName: username };
  accounts.push(user);
  writeJSON('accounts.json', accounts);

  const devs = readJSON('devs.json', []);
  devs.push({ id, username, bio: '', avatar: '/public/img/logo.svg', approved: true, verified: true });
  writeJSON('devs.json', devs);

  const ver = readJSON('verifications.json', { verified: {} });
  ver.verified[id] = { by: 'admin', date: Date.now(), badge: 'verified' };
  writeJSON('verifications.json', ver);

  const followers = readJSON('followers.json', { baseBoost: {}, edges: [] });
  followers.baseBoost[id] = (followers.baseBoost[id] || 0) + Math.max(0, Number(followersBoost)||0);
  writeJSON('followers.json', followers);

  res.json({ ok: true, user: safeUser(user) });
});

// Root routes

app.get('/', (req, res) => res.redirect('/html/index.html'));
// 🔁 Self-ping every 5 seconds (to keep Render awake)
const SELF_URL = (process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

setInterval(async () => {
  try {
    const r = await fetch(`${SELF_URL}/ping`);
    await r.text(); // or .json() if you return JSON
    console.log("🔁 Self-pinged", new Date().toISOString());
  } catch (err) {
    console.log("⚠️ Ping failed:", err.message);
  }
}, 5000);

// Optional: add a /ping route if not already there
app.get("/ping", (req, res) => {
  res.json({ pong: true, time: new Date().toISOString() });
});
app.listen(PORT, () => {
  console.log(`ZIPHUB running on http://localhost:${PORT}`);
});