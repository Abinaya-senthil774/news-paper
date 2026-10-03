// Authentication: register / login / logout / me, using bcrypt + a JWT in an httpOnly cookie.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const COOKIE = 'cc_token';

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  // Generate once and persist so sessions survive restarts.
  const file = path.join(__dirname, '..', 'data', '.jwt-secret');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(file, secret);
    return secret;
  }
}
const SECRET = loadSecret();

const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.display_name });

function issueCookie(res, user) {
  const token = jwt.sign({ uid: user.id }, SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: 'Please sign in' });
  try {
    const { uid } = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(uid);
    if (!user) throw new Error('missing user');
    req.user = user;
    next();
  } catch {
    res.clearCookie(COOKIE);
    res.status(401).json({ error: 'Your session expired, please sign in again' });
  }
}

const router = express.Router();

router.post('/register', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const displayName = String(req.body.displayName || '').trim() || username;
  const password = String(req.body.password || '');

  if (!/^[a-z0-9_.]{3,24}$/.test(username))
    return res.status(400).json({ error: 'Username must be 3–24 characters: letters, numbers, _ or .' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (displayName.length > 40)
    return res.status(400).json({ error: 'Display name is too long' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username))
    return res.status(409).json({ error: 'That username is taken' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(username, displayName, hash, new Date().toISOString());
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  issueCookie(res, user);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Wrong username or password' });
  issueCookie(res, user);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

module.exports = { router, requireAuth, publicUser };
