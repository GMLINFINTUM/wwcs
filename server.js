// WWCS — Washington Weather and Climate Services (standalone edition).
// Express backend: serves the static frontend and provides the community API
// (spotters, observations, blog, chat) backed by PostgreSQL.
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { moderate } = require('./moderation');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_COOKIE = 'wwcs_session';

// ---- Database (optional at boot so the site still renders without one) ----
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  pool.on('error', (err) => console.error('DB pool error:', err.message));
}

function needDb(res) {
  if (!pool) {
    res.status(503).json({ error: 'Database is not configured yet. Run the migration (see README).' });
    return true;
  }
  return false;
}

// ---- Middleware ----
app.use(express.json({ limit: '64kb' }));
// PWA: serve the web app manifest with its proper content type.
app.use((req, res, next) => {
  if (req.path.endsWith('.webmanifest')) res.type('application/manifest+json');
  next();
});

// ---- Page view counter (privacy-friendly: per-page, per-day hit counts; no IPs stored) ----
// Runs before the static handler and is fire-and-forget, so a DB hiccup never
// slows down or breaks page loads.
app.use((req, res, next) => {
  if (pool && req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html'))) {
    const page = req.path === '/' ? '/index.html' : req.path;
    pool.query(
      `INSERT INTO page_views (path, day, hits) VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (path, day) DO UPDATE SET hits = page_views.hits + 1`,
      [page]
    ).catch((err) => console.error('page view count failed:', err.message));
  }
  next();
});
app.use(express.static('public', { extensions: ['html'] }));

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function currentUser(req) {
  if (!pool) return null;
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.email, s.county, s.created_at
       FROM spotters s JOIN sessions t ON t.spotter_id = s.id
      WHERE t.token = $1 AND t.expires_at > NOW()`,
    [token]
  );
  return rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Please sign in as a spotter first.' });
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Auth lookup failed.' });
  }
}

// ---- Health ----
app.get('/api/health', (req, res) => res.json({ ok: true, db: !!pool }));

// ---- Spotter accounts ----
app.post('/api/register', async (req, res) => {
  if (needDb(res)) return;
  const { name, email, password, county } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO spotters (name, email, password_hash, county) VALUES ($1,$2,$3,$4) RETURNING id, name, email, county, created_at',
      [name.trim(), email.trim().toLowerCase(), hash, (county || '').trim() || null]
    );
    const user = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query('INSERT INTO sessions (token, spotter_id) VALUES ($1,$2)', [token, user.id]);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000, path: '/' });
    res.json({ user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That email is already registered.' });
    console.error(err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/login', async (req, res) => {
  if (needDb(res)) return;
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  try {
    const { rows } = await pool.query('SELECT * FROM spotters WHERE email = $1', [email.trim().toLowerCase()]);
    const spotter = rows[0];
    if (!spotter || !(await bcrypt.compare(password, spotter.password_hash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query('INSERT INTO sessions (token, spotter_id) VALUES ($1,$2)', [token, spotter.id]);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000, path: '/' });
    res.json({ user: { id: spotter.id, name: spotter.name, email: spotter.email, county: spotter.county, created_at: spotter.created_at } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/api/logout', async (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (pool && token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]).catch(() => {});
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  if (needDb(res)) return;
  try {
    res.json({ user: (await currentUser(req)) || null });
  } catch {
    res.status(500).json({ error: 'Lookup failed.' });
  }
});

// Public spotter directory (Spotter Center).
app.get('/api/spotters', async (req, res) => {
  if (needDb(res)) return;
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.county, s.created_at,
              (SELECT COUNT(*) FROM observations o WHERE o.spotter_id = s.id)::int AS observations,
              (SELECT COUNT(*) FROM blog_posts b WHERE b.spotter_id = s.id)::int AS posts
         FROM spotters s ORDER BY s.created_at DESC LIMIT 200`
    );
    res.json({ spotters: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load spotters.' });
  }
});

// ---- Observations ----
app.get('/api/observations', async (req, res) => {
  if (needDb(res)) return;
  try {
    const { rows } = await pool.query(
      `SELECT o.*, s.name AS spotter_name
         FROM observations o JOIN spotters s ON s.id = o.spotter_id
        ORDER BY o.created_at DESC LIMIT 200`
    );
    res.json({ observations: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load observations.' });
  }
});

app.post('/api/observations', requireAuth, async (req, res) => {
  const { location, zip, observed_at, weather_type, temperature_f, notes } = req.body || {};
  if (!location || !location.trim()) return res.status(400).json({ error: 'Location is required.' });
  if (!weather_type || !weather_type.trim()) return res.status(400).json({ error: 'Weather type is required.' });
  if (zip && !/^\d{5}$/.test(String(zip).trim())) return res.status(400).json({ error: 'ZIP must be 5 digits.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO observations (spotter_id, location, zip, observed_at, weather_type, temperature_f, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        req.user.id,
        location.trim(),
        (zip || '').trim() || null,
        observed_at ? new Date(observed_at) : new Date(),
        weather_type.trim(),
        temperature_f === '' || temperature_f == null ? null : Number(temperature_f),
        (notes || '').trim() || null,
      ]
    );
    res.json({ observation: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save observation.' });
  }
});

// ---- Blog ----
app.get('/api/blog', async (req, res) => {
  if (needDb(res)) return;
  try {
    const { rows } = await pool.query(
      `SELECT b.*, s.name AS author FROM blog_posts b
         JOIN spotters s ON s.id = b.spotter_id
        ORDER BY b.created_at DESC LIMIT 100`
    );
    res.json({ posts: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load posts.' });
  }
});

app.post('/api/blog', requireAuth, async (req, res) => {
  const { title, body } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required.' });
  if (!body || !body.trim()) return res.status(400).json({ error: 'Body is required.' });
  if (title.length > 200) return res.status(400).json({ error: 'Title is too long (max 200 characters).' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO blog_posts (spotter_id, title, body) VALUES ($1,$2,$3) RETURNING *',
      [req.user.id, title.trim(), body.trim()]
    );
    res.json({ post: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not publish post.' });
  }
});

// ---- Live chat ----
const chatLimits = new Map(); // key -> { count, windowStart, lastBody, lastAt }
const CHAT_WINDOW_MS = 60_000;
const CHAT_MAX_PER_WINDOW = 6;

function chatAllowed(key, body) {
  const now = Date.now();
  let st = chatLimits.get(key);
  if (!st || now - st.windowStart > CHAT_WINDOW_MS) st = { count: 0, windowStart: now, lastBody: '', lastAt: 0 };
  if (body === st.lastBody && now - st.lastAt < 60_000) {
    return { ok: false, reason: 'Duplicate message — please wait before reposting.' };
  }
  if (st.count >= CHAT_MAX_PER_WINDOW) {
    return { ok: false, reason: 'Slow down — too many messages. Try again in a minute.' };
  }
  st.count += 1;
  st.lastBody = body;
  st.lastAt = now;
  chatLimits.set(key, st);
  return { ok: true };
}

app.get('/api/chat', async (req, res) => {
  if (needDb(res)) return;
  try {
    const since = req.query.since ? new Date(req.query.since) : null;
    const { rows } = await pool.query(
      since && !isNaN(since)
        ? 'SELECT * FROM chat_messages WHERE created_at > $1 ORDER BY created_at ASC LIMIT 100'
        : 'SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 50',
      since && !isNaN(since) ? [since] : []
    );
    const msgs = since && !isNaN(since) ? rows : rows.reverse();
    res.json({ messages: msgs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load chat.' });
  }
});

app.post('/api/chat', async (req, res) => {
  if (needDb(res)) return;
  const { body } = req.body || {};
  const user = await currentUser(req).catch(() => null);
  const displayName = user ? user.name : 'Guest';
  const key = (user ? 'u' + user.id : 'ip' + (req.ip || 'x'));

  const limit = chatAllowed(key, body);
  if (!limit.ok) return res.status(429).json({ error: limit.reason });

  const check = await moderate(body);
  if (!check.ok) return res.status(400).json({ error: check.reason });

  try {
    const { rows } = await pool.query(
      'INSERT INTO chat_messages (spotter_id, display_name, body) VALUES ($1,$2,$3) RETURNING *',
      [user ? user.id : null, displayName, body.trim()]
    );
    res.json({ message: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not send message.' });
  }
});

// ---- NWS alerts proxy (adds a proper User-Agent; api.weather.gov requires one) ----
app.get('/api/alerts', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon || isNaN(+lat) || isNaN(+lon)) {
    return res.status(400).json({ error: 'lat and lon query params are required.' });
  }
  try {
    const r = await fetch(`https://api.weather.gov/alerts/active?point=${+lat},${+lon}`, {
      headers: { 'User-Agent': 'WWCS (washington weather community site)', Accept: 'application/geo+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error('NWS responded ' + r.status);
    const data = await r.json();
    res.json({ alerts: (data.features || []).map((f) => f.properties) });
  } catch (err) {
    res.status(502).json({ error: 'Could not reach the National Weather Service.' });
  }
});

// ---- Site traffic stats (logged-in spotters only) ----
app.get('/api/stats', requireAuth, async (req, res) => {
  if (needDb(res)) return;
  try {
    const total = await pool.query('SELECT COALESCE(SUM(hits), 0) AS total FROM page_views');
    const byPage = await pool.query(
      'SELECT path, SUM(hits) AS hits FROM page_views GROUP BY path ORDER BY hits DESC'
    );
    const byDay = await pool.query(
      `SELECT day, SUM(hits) AS hits FROM page_views
       WHERE day > CURRENT_DATE - INTERVAL '30 days'
       GROUP BY day ORDER BY day`
    );
    res.json({
      total: Number(total.rows[0].total),
      byPage: byPage.rows.map((r) => ({ path: r.path, hits: Number(r.hits) })),
      byDay: byDay.rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), hits: Number(r.hits) })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load stats.' });
  }
});

app.listen(PORT, () => console.log(`WWCS listening on port ${PORT}`));
