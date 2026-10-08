// Accounts: sign up (with an emailed code), sign in, sign out, and account settings
// (name, username, email, password, forgot password).
// Sessions are a JWT in an httpOnly cookie; passwords are hashed with bcrypt.

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { sendMail, layout } = require('./mailer');

const COOKIE = 'cc_token';

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  // Generate once and persist so sessions survive restarts.
  const file = path.join(__dirname, '..', 'data', '.jwt-secret');

  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    const secret = crypto.randomBytes(48).toString('hex');

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret);

    return secret;
  }
}

const SECRET = loadSecret();

const USER_COLS = 'id, username, display_name, email, email_verified, notify_email, session_version';

const publicUser = (u) => ({
  id: Number(u.id),
  username: u.username,
  displayName: u.display_name,
  email: u.email || null,
  emailVerified: !!u.email_verified,
  notifyEmail: u.notify_email !== false,
});

/* ---------- validation ---------- */

const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const cleanEmail = (v) => String(v || '').trim().toLowerCase();
const cleanUsername = (v) => String(v || '').trim().toLowerCase().replace(/^@/, '');

const RESERVED = new Set(['admin', 'administrator', 'root', 'support', 'help', 'api', 'system', 'null', 'undefined', 'me', 'shelf', 'paper']);

function usernameProblem(u) {
  if (u.length < 3) return 'At least 3 characters';
  if (u.length > 24) return 'At most 24 characters';
  if (!USERNAME_RE.test(u)) return 'Only letters, numbers, _ and .';
  if (/^[._]|[._]$/.test(u)) return "Can't start or end with . or _";
  if (/\.\./.test(u)) return "Can't have two dots in a row";
  if (RESERVED.has(u)) return 'That name is reserved';
  return null;
}
const emailProblem = (e) => (!EMAIL_RE.test(e) || e.length > 254 ? 'Please enter a valid email address' : null);
const passwordProblem = (p) =>
  p.length < 6 ? 'Password must be at least 6 characters' : p.length > 200 ? 'Password is too long' : null;

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

// Wrap async route handlers: HttpError -> its status, anything else -> 500.
const route = (label, fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err.code === '23505') {
      const onEmail = /email/.test(err.constraint || '');
      return res.status(409).json({ error: onEmail ? 'That email is already used by another account' : 'That username is taken' });
    }
    console.error(`${label} error:`, err);
    res.status(500).json({ error: 'Something went wrong, please try again' });
  }
};

async function usernameTaken(username, exceptUserId = null) {
  const r = await db.query('SELECT id FROM users WHERE username = $1', [username]);
  return r.rows.some((row) => String(row.id) !== String(exceptUserId));
}

// An email counts as "taken" only when another account has *verified* it.
async function emailTaken(email, exceptUserId = null) {
  const r = await db.query('SELECT id FROM users WHERE lower(email) = $1 AND email_verified', [email]);
  return r.rows.some((row) => String(row.id) !== String(exceptUserId));
}

/* ---------- sessions ---------- */

function issueCookie(res, user) {
  const token = jwt.sign({ uid: Number(user.id), v: user.session_version || 0 }, SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

async function userFromCookie(req) {
  const token = req.cookies[COOKIE];
  if (!token) return null;
  try {
    const { uid, v = 0 } = jwt.verify(token, SECRET);
    const result = await db.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [uid]);
    const user = result.rows[0];
    // A password change bumps session_version, which signs out old cookies.
    if (!user || (user.session_version || 0) !== v) return null;
    return user;
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  if (!req.cookies[COOKIE]) return res.status(401).json({ error: 'Please sign in' });
  const user = await userFromCookie(req);
  if (!user) {
    res.clearCookie(COOKIE);
    return res.status(401).json({ error: 'Your session expired, please sign in again' });
  }
  req.user = user;
  next();
}

/* ---------- one-time email codes ---------- */

const CODE_TTL_MIN = 10;
const RESEND_AFTER_SEC = 60;
const MAX_SENDS_PER_HOUR = 5;
const MAX_TRIES = 5;

const hashCode = (purpose, email, code) =>
  crypto.createHmac('sha256', SECRET).update(`${purpose}:${email}:${code}`).digest('hex');

const CODE_TEXT = {
  signup: { subject: 'is your dʌmi News sign-up code', kicker: 'Welcome aboard', headline: 'Confirm your email', body: 'Enter this code on the sign-up page to finish creating your account.' },
  change_email: { subject: 'is your code to confirm your new email', kicker: 'Account', headline: 'Confirm your new email', body: 'Enter this code in your account settings to start using this email address.' },
  reset_password: { subject: 'is your dʌmi News password reset code', kicker: 'Account', headline: 'Reset your password', body: 'Enter this code to choose a new password. If you didn\'t ask to reset it, your account is safe and you can ignore this email.' },
};

async function sendCode({ email, purpose, userId = null }) {
  const recent = await db.query(
    `SELECT created_at FROM email_codes
     WHERE email = $1 AND purpose = $2 AND created_at > now() - INTERVAL '1 hour'
     ORDER BY created_at DESC`,
    [email, purpose]
  );
  if (recent.rows.length) {
    const ago = (Date.now() - new Date(recent.rows[0].created_at).getTime()) / 1000;
    if (ago < RESEND_AFTER_SEC) {
      const wait = Math.ceil(RESEND_AFTER_SEC - ago);
      throw new HttpError(429, `Please wait ${wait}s before asking for another code`, { retryIn: wait });
    }
    if (recent.rows.length >= MAX_SENDS_PER_HOUR) {
      throw new HttpError(429, 'Too many codes sent to this email. Try again in an hour.');
    }
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const ins = await db.query(
    `INSERT INTO email_codes (email, purpose, user_id, code_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval, now())
     RETURNING id`,
    [email, purpose, userId, hashCode(purpose, email, code), String(CODE_TTL_MIN)]
  );

  const t = CODE_TEXT[purpose];
  try {
    await sendMail({
      to: email,
      subject: `${code} ${t.subject}`,
      text: `${t.body}\n\nYour code: ${code}\n\nIt works for ${CODE_TTL_MIN} minutes.`,
      html: layout({ kicker: t.kicker, headline: t.headline, body: t.body, code, footer: 'dʌmi News, your daily journal printed as a newspaper.' }),
    });
  } catch (err) {
    console.error('Could not send code email:', err.message);
    await db.query('DELETE FROM email_codes WHERE id = $1', [ins.rows[0].id]);
    throw new HttpError(502, "We couldn't send the email right now. Check the address, or try again in a minute.");
  }

  return { sent: true, email, retryIn: RESEND_AFTER_SEC };
}

// Throws HttpError if the code is wrong/expired; on success the code is used up.
async function useCode({ email, purpose, code, userId = null }) {
  code = String(code || '').replace(/\D/g, '');
  if (code.length !== 6) throw new HttpError(400, 'Enter the 6-digit code from the email');

  const r = await db.query(
    `SELECT id, user_id, code_hash, attempts, expires_at FROM email_codes
     WHERE email = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1`,
    [email, purpose]
  );
  const row = r.rows[0];
  if (!row || (userId && String(row.user_id) !== String(userId))) {
    throw new HttpError(400, 'No code found for this email. Send a new one.');
  }
  if (new Date(row.expires_at) < new Date()) throw new HttpError(400, 'That code has expired. Send a new one.');
  if (row.attempts >= MAX_TRIES) throw new HttpError(429, 'Too many wrong tries. Send a new code.');

  const ok = crypto.timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(hashCode(purpose, email, code), 'hex'));
  if (!ok) {
    await db.query('UPDATE email_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    const left = MAX_TRIES - row.attempts - 1;
    throw new HttpError(400, left > 0 ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Wrong code. Send a new one.');
  }

  await db.query('DELETE FROM email_codes WHERE email = $1 AND purpose = $2', [email, purpose]);
  // Housekeeping: drop expired codes from everyone.
  db.query("DELETE FROM email_codes WHERE expires_at < now() - INTERVAL '1 day'").catch(() => {});
  return row;
}

// Once someone verifies an email, release it from any account that typed it but never verified it.
const releaseUnverified = (c, email, exceptId) =>
  c.query('UPDATE users SET email = NULL WHERE lower(email) = $1 AND NOT email_verified AND id <> $2', [email, exceptId]);

/* ---------- routes ---------- */

const router = express.Router();

// Live "is this username free?" check. Works signed in (your own name counts as yours) or out.
router.get('/username-available', route('Username check', async (req, res) => {
  const u = cleanUsername(req.query.u);
  const problem = usernameProblem(u);
  if (problem) return res.json({ username: u, available: false, reason: problem });

  const me = await userFromCookie(req);
  if (me && me.username === u) return res.json({ username: u, available: true, mine: true, reason: "That's your current username" });

  if (!(await usernameTaken(u))) return res.json({ username: u, available: true });

  // Offer a few free alternatives.
  const base = u.replace(/[._]?\d+$/, '').slice(0, 19) || u.slice(0, 19);
  const candidates = [`${base}${new Date().getFullYear() % 100}`, `${base}_${crypto.randomInt(10, 99)}`, `${base}.${crypto.randomInt(100, 999)}`, `the.${base}`.slice(0, 24)];
  const free = [];
  for (const c of candidates) {
    if (!usernameProblem(c) && !(await usernameTaken(c))) free.push(c);
    if (free.length === 3) break;
  }
  res.json({ username: u, available: false, reason: 'That username is taken', suggestions: free });
}));

// SIGN UP, step 1: check everything and email a 6-digit code.
function readSignup(body) {
  const username = cleanUsername(body.username);
  const email = cleanEmail(body.email);
  const password = String(body.password || '');
  const displayName = String(body.displayName || '').trim() || username;
  const problem = usernameProblem(username) || emailProblem(email) || passwordProblem(password)
    || (displayName.length > 40 ? 'Name is too long' : null);
  if (problem) throw new HttpError(400, problem);
  return { username, email, password, displayName };
}

router.post('/register/start', route('Register start', async (req, res) => {
  const { username, email } = readSignup(req.body);
  if (await usernameTaken(username)) throw new HttpError(409, 'That username is taken');
  if (await emailTaken(email)) throw new HttpError(409, 'An account with that email already exists. Try signing in.');
  res.json(await sendCode({ email, purpose: 'signup' }));
}));

// SIGN UP, step 2: same details + the code -> account is created and signed in.
router.post('/register', route('Register', async (req, res) => {
  const { username, email, password, displayName } = readSignup(req.body);
  if (await usernameTaken(username)) throw new HttpError(409, 'That username was just taken. Pick another.');
  if (await emailTaken(email)) throw new HttpError(409, 'An account with that email already exists. Try signing in.');
  await useCode({ email, purpose: 'signup', code: req.body.code });

  const hash = await bcrypt.hash(password, 10);
  const user = await db.tx(async (c) => {
    await releaseUnverified(c, email, 0);
    const r = await c.query(
      `INSERT INTO users (username, display_name, password_hash, email, email_verified, created_at)
       VALUES ($1, $2, $3, $4, TRUE, $5)
       RETURNING ${USER_COLS}`,
      [username, displayName, hash, email, new Date().toISOString()]
    );
    return r.rows[0];
  });

  issueCookie(res, user);
  res.status(201).json({ user: publicUser(user) });
}));

// SIGN IN with username or (verified) email.
router.post('/login', route('Login', async (req, res) => {
  const login = String(req.body.username || '').trim().toLowerCase().replace(/^@/, '');
  const password = String(req.body.password || '');
  const result = login.includes('@')
    ? await db.query(`SELECT ${USER_COLS}, password_hash FROM users WHERE lower(email) = $1 AND email_verified`, [login])
    : await db.query(`SELECT ${USER_COLS}, password_hash FROM users WHERE username = $1`, [login]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'Wrong username or password');
  }
  issueCookie(res, user);
  res.json({ user: publicUser(user) });
}));

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

// Display name and email-notification switch.
router.patch('/me', requireAuth, route('Update profile', async (req, res) => {
  const u = req.user;
  let displayName = u.display_name;
  let notifyEmail = u.notify_email !== false;
  if (req.body.displayName !== undefined) {
    displayName = String(req.body.displayName || '').trim();
    if (!displayName || displayName.length > 40) throw new HttpError(400, 'Name must be 1–40 characters');
  }
  if (req.body.notifyEmail !== undefined) notifyEmail = !!req.body.notifyEmail;
  const r = await db.query(
    `UPDATE users SET display_name = $1, notify_email = $2 WHERE id = $3 RETURNING ${USER_COLS}`,
    [displayName, notifyEmail, u.id]
  );
  res.json({ user: publicUser(r.rows[0]) });
}));

// Change username.
router.post('/username', requireAuth, route('Change username', async (req, res) => {
  const username = cleanUsername(req.body.username);
  const problem = usernameProblem(username);
  if (problem) throw new HttpError(400, problem);
  if (username === req.user.username) return res.json({ user: publicUser(req.user) });
  if (await usernameTaken(username, req.user.id)) throw new HttpError(409, 'That username is taken');
  const r = await db.query(`UPDATE users SET username = $1 WHERE id = $2 RETURNING ${USER_COLS}`, [username, req.user.id]);
  res.json({ user: publicUser(r.rows[0]) });
}));

// Change (or verify) email, step 1: send a code to the new address.
router.post('/email/start', requireAuth, route('Email start', async (req, res) => {
  const email = cleanEmail(req.body.email);
  const problem = emailProblem(email);
  if (problem) throw new HttpError(400, problem);
  if (email === cleanEmail(req.user.email) && req.user.email_verified) {
    throw new HttpError(400, 'That is already your email');
  }
  if (await emailTaken(email, req.user.id)) throw new HttpError(409, 'That email is already used by another account');
  res.json(await sendCode({ email, purpose: 'change_email', userId: req.user.id }));
}));

// Change (or verify) email, step 2: the code proves you own it.
router.post('/email/verify', requireAuth, route('Email verify', async (req, res) => {
  const email = cleanEmail(req.body.email);
  if (emailProblem(email)) throw new HttpError(400, 'Please enter a valid email address');
  if (await emailTaken(email, req.user.id)) throw new HttpError(409, 'That email is already used by another account');
  await useCode({ email, purpose: 'change_email', code: req.body.code, userId: req.user.id });
  const user = await db.tx(async (c) => {
    await releaseUnverified(c, email, req.user.id);
    const r = await c.query(
      `UPDATE users SET email = $1, email_verified = TRUE WHERE id = $2 RETURNING ${USER_COLS}`,
      [email, req.user.id]
    );
    return r.rows[0];
  });
  res.json({ user: publicUser(user) });
}));

// Change password (needs the current one). Signs out your other devices.
router.post('/password', requireAuth, route('Change password', async (req, res) => {
  const current = String(req.body.currentPassword || '');
  const next = String(req.body.newPassword || '');
  const problem = passwordProblem(next);
  if (problem) throw new HttpError(400, problem);
  const r = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(current, r.rows[0].password_hash))) throw new HttpError(400, 'Your current password is wrong');
  if (current === next) throw new HttpError(400, 'The new password is the same as the old one');
  const hash = await bcrypt.hash(next, 10);
  const u = await db.query(
    `UPDATE users SET password_hash = $1, session_version = session_version + 1 WHERE id = $2 RETURNING ${USER_COLS}`,
    [hash, req.user.id]
  );
  issueCookie(res, u.rows[0]); // keep *this* device signed in
  res.json({ user: publicUser(u.rows[0]) });
}));

// Forgot password, step 1. Always answers the same way, so it can't be used to
// find out which emails have accounts.
router.post('/password/forgot', route('Forgot password', async (req, res) => {
  const email = cleanEmail(req.body.email);
  if (emailProblem(email)) throw new HttpError(400, 'Please enter a valid email address');
  const r = await db.query('SELECT id FROM users WHERE lower(email) = $1 AND email_verified', [email]);
  if (r.rows[0]) {
    await sendCode({ email, purpose: 'reset_password', userId: r.rows[0].id });
  }
  res.json({ sent: true, email, retryIn: RESEND_AFTER_SEC });
}));

// Forgot password, step 2: code + new password -> signed in.
router.post('/password/reset', route('Reset password', async (req, res) => {
  const email = cleanEmail(req.body.email);
  const next = String(req.body.newPassword || '');
  const problem = passwordProblem(next);
  if (problem) throw new HttpError(400, problem);
  const row = await useCode({ email, purpose: 'reset_password', code: req.body.code });
  const hash = await bcrypt.hash(next, 10);
  const u = await db.query(
    `UPDATE users SET password_hash = $1, session_version = session_version + 1
     WHERE id = $2 AND lower(email) = $3 AND email_verified RETURNING ${USER_COLS}`,
    [hash, row.user_id, email]
  );
  if (!u.rows[0]) throw new HttpError(400, 'That account no longer uses this email');
  issueCookie(res, u.rows[0]);
  res.json({ user: publicUser(u.rows[0]) });
}));

module.exports = {
  router,
  requireAuth,
  publicUser,
};
