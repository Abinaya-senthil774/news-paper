// Authentication: register / login / logout / me,
// using bcrypt + a JWT in an httpOnly cookie.

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

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret);

    return secret;
  }
}

const SECRET = loadSecret();

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name
});

function issueCookie(res, user) {
  const token = jwt.sign(
    { uid: user.id },
    SECRET,
    { expiresIn: '30d' }
  );

  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

async function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE];

  if (!token) {
    return res.status(401).json({
      error: 'Please sign in'
    });
  }

  try {
    const { uid } = jwt.verify(token, SECRET);

    const result = await db.query(
      'SELECT id, username, display_name FROM users WHERE id = $1',
      [uid]
    );

    const user = result.rows[0];

    if (!user) {
      throw new Error('missing user');
    }

    req.user = user;
    next();

  } catch (error) {
    res.clearCookie(COOKIE);

    res.status(401).json({
      error: 'Your session expired, please sign in again'
    });
  }
}

const router = express.Router();


// REGISTER
router.post('/register', async (req, res) => {
  try {
    const username = String(req.body.username || '')
      .trim()
      .toLowerCase();

    const displayName =
      String(req.body.displayName || '').trim() || username;

    const password = String(req.body.password || '');

    if (!/^[a-z0-9_.]{3,24}$/.test(username)) {
      return res.status(400).json({
        error: 'Username must be 3–24 characters: letters, numbers, _ or .'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters'
      });
    }

    if (displayName.length > 40) {
      return res.status(400).json({
        error: 'Display name is too long'
      });
    }

    // Check whether username already exists
    const existing = await db.query(
      'SELECT 1 FROM users WHERE username = $1',
      [username]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'That username is taken'
      });
    }

    const hash = await bcrypt.hash(password, 10);

    // Insert user and get the generated PostgreSQL ID
    const result = await db.query(
      `
      INSERT INTO users
        (username, display_name, password_hash, created_at)
      VALUES
        ($1, $2, $3, $4)
      RETURNING *
      `,
      [
        username,
        displayName,
        hash,
        new Date().toISOString()
      ]
    );

    const user = result.rows[0];

    issueCookie(res, user);

    res.status(201).json({
      user: publicUser(user)
    });

  } catch (error) {
    console.error('Register error:', error);

    // Handles PostgreSQL UNIQUE constraint safely
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'That username is taken'
      });
    }

    res.status(500).json({
      error: 'Unable to create account'
    });
  }
});


// LOGIN
router.post('/login', async (req, res) => {
  try {
    const username = String(req.body.username || '')
      .trim()
      .toLowerCase();

    const password = String(req.body.password || '');

    const result = await db.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    const user = result.rows[0];

    if (
      !user ||
      !(await bcrypt.compare(password, user.password_hash))
    ) {
      return res.status(401).json({
        error: 'Wrong username or password'
      });
    }

    issueCookie(res, user);

    res.json({
      user: publicUser(user)
    });

  } catch (error) {
    console.error('Login error:', error);

    res.status(500).json({
      error: 'Unable to sign in'
    });
  }
});


// LOGOUT
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE);

  res.json({
    ok: true
  });
});


// CURRENT USER
router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: publicUser(req.user)
  });
});


module.exports = {
  router,
  requireAuth,
  publicUser
};