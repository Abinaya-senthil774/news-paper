// Newspapers (months), pages (days) and sharing.
const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

const now = () => new Date().toISOString();
const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
const canEdit = (role) => role === 'owner' || role === 'edit';
const MAX_CONTENT_BYTES = 20 * 1024 * 1024;

const PAPER_SELECT = `
  SELECT n.*, u.username AS owner_username, u.display_name AS owner_name,
         (SELECT COUNT(*) FROM pages p WHERE p.newspaper_id = n.id) AS page_count
  FROM newspapers n JOIN users u ON u.id = n.owner_id`;

function serializePaper(row, role) {
  return {
    id: row.id,
    title: row.title,
    year: row.year,
    month: row.month,
    ownerId: row.owner_id,
    ownerUsername: row.owner_username,
    ownerName: row.owner_name,
    pageCount: row.page_count,
    updatedAt: row.updated_at,
    role,
  };
}

function serializePage(row) {
  return {
    id: row.id,
    day: row.day,
    content: JSON.parse(row.content),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by_name || null,
  };
}

function roleFor(paperId, userId) {
  const paper = db.prepare(`${PAPER_SELECT} WHERE n.id = ?`).get(paperId);
  if (!paper) return { paper: null, role: null };
  if (paper.owner_id === userId) return { paper, role: 'owner' };
  const share = db.prepare('SELECT role FROM shares WHERE newspaper_id = ? AND user_id = ?').get(paperId, userId);
  return { paper, role: share ? share.role : null };
}

// Middleware: load newspaper :id and enforce a minimum role ('view' | 'edit' | 'owner').
function withPaper(minRole) {
  return (req, res, next) => {
    const { paper, role } = roleFor(Number(req.params.id), req.user.id);
    if (!paper || !role) return res.status(404).json({ error: 'Newspaper not found' });
    if (minRole === 'edit' && !canEdit(role)) return res.status(403).json({ error: 'You only have view access' });
    if (minRole === 'owner' && role !== 'owner') return res.status(403).json({ error: 'Only the owner can do that' });
    req.paper = paper;
    req.role = role;
    next();
  };
}

// Middleware: load page :pid and its newspaper; requires edit access.
function withPageForEdit(req, res, next) {
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(Number(req.params.pid));
  if (!page) return res.status(404).json({ error: 'Page not found' });
  const { paper, role } = roleFor(page.newspaper_id, req.user.id);
  if (!paper || !role) return res.status(404).json({ error: 'Page not found' });
  if (!canEdit(role)) return res.status(403).json({ error: 'You only have view access' });
  req.page = page;
  req.paper = paper;
  next();
}

function validateContent(content) {
  if (!content || typeof content !== 'object' || !Array.isArray(content.elements))
    return 'Invalid page content';
  if (content.elements.length > 300) return 'Too many elements on one page';
  const json = JSON.stringify({ elements: content.elements });
  if (Buffer.byteLength(json) > MAX_CONTENT_BYTES) return 'Page is too large (try smaller images)';
  return null;
}

const touchPaper = (id) => db.prepare('UPDATE newspapers SET updated_at = ? WHERE id = ?').run(now(), id);

/* ---------- Newspapers ---------- */

router.get('/papers', (req, res) => {
  const mine = db
    .prepare(`${PAPER_SELECT} WHERE n.owner_id = ? ORDER BY n.year DESC, n.month DESC`)
    .all(req.user.id)
    .map((r) => serializePaper(r, 'owner'));
  const shared = db
    .prepare(
      `${PAPER_SELECT.replace('FROM newspapers n', 'FROM newspapers n JOIN shares s ON s.newspaper_id = n.id')}
       WHERE s.user_id = ? ORDER BY n.year DESC, n.month DESC`
    )
    .all(req.user.id);
  const roles = db.prepare('SELECT newspaper_id, role FROM shares WHERE user_id = ?').all(req.user.id);
  const roleMap = Object.fromEntries(roles.map((r) => [r.newspaper_id, r.role]));
  res.json({ mine, shared: shared.map((r) => serializePaper(r, roleMap[r.id])) });
});

router.post('/papers', (req, res) => {
  const year = Number(req.body.year);
  const month = Number(req.body.month);
  const title = String(req.body.title || '').trim().slice(0, 60) || `The ${req.user.display_name} Times`;
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return res.status(400).json({ error: 'Invalid year' });
  if (!Number.isInteger(month) || month < 1 || month > 12) return res.status(400).json({ error: 'Invalid month' });

  try {
    const t = now();
    const info = db
      .prepare('INSERT INTO newspapers (owner_id, title, year, month, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, title, year, month, t, t);
    const row = db.prepare(`${PAPER_SELECT} WHERE n.id = ?`).get(info.lastInsertRowid);
    res.status(201).json({ paper: serializePaper(row, 'owner') });
  } catch (e) {
    if (String(e.message).includes('UNIQUE'))
      return res.status(409).json({ error: 'You already have a newspaper for that month' });
    throw e;
  }
});

router.get('/papers/:id', withPaper('view'), (req, res) => {
  const pages = db
    .prepare(
      `SELECT p.*, u.display_name AS updated_by_name FROM pages p
       LEFT JOIN users u ON u.id = p.updated_by
       WHERE p.newspaper_id = ? ORDER BY p.day`
    )
    .all(req.paper.id)
    .map(serializePage);
  res.json({ paper: serializePaper(req.paper, req.role), pages });
});

router.patch('/papers/:id', withPaper('edit'), (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 60);
  if (!title) return res.status(400).json({ error: 'Title cannot be empty' });
  db.prepare('UPDATE newspapers SET title = ?, updated_at = ? WHERE id = ?').run(title, now(), req.paper.id);
  res.json({ ok: true, title });
});

router.delete('/papers/:id', withPaper('owner'), (req, res) => {
  db.prepare('DELETE FROM newspapers WHERE id = ?').run(req.paper.id);
  res.json({ ok: true });
});

/* ---------- Pages ---------- */

router.post('/papers/:id/pages', withPaper('edit'), (req, res) => {
  const day = Number(req.body.day);
  const max = daysInMonth(req.paper.year, req.paper.month);
  if (!Number.isInteger(day) || day < 1 || day > max)
    return res.status(400).json({ error: `Day must be between 1 and ${max}` });
  const content = req.body.content || { elements: [] };
  const err = validateContent(content);
  if (err) return res.status(400).json({ error: err });

  try {
    const info = db
      .prepare('INSERT INTO pages (newspaper_id, day, content, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)')
      .run(req.paper.id, day, JSON.stringify({ elements: content.elements }), now(), req.user.id);
    touchPaper(req.paper.id);
    const row = db
      .prepare('SELECT p.*, u.display_name AS updated_by_name FROM pages p LEFT JOIN users u ON u.id = p.updated_by WHERE p.id = ?')
      .get(info.lastInsertRowid);
    res.status(201).json({ page: serializePage(row) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'That day already has a page' });
    throw e;
  }
});

// Save a page. "Save & refresh" collaboration: if someone else saved since you loaded
// (baseUpdatedAt mismatch), we return 409 unless force=true.
router.put('/pages/:pid', withPageForEdit, (req, res) => {
  const { content, baseUpdatedAt, force } = req.body;
  const err = validateContent(content);
  if (err) return res.status(400).json({ error: err });

  if (!force && baseUpdatedAt && baseUpdatedAt !== req.page.updated_at) {
    const who = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.page.updated_by);
    return res.status(409).json({
      error: 'This page was changed by someone else since you opened it',
      conflict: true,
      updatedBy: who ? who.display_name : 'someone',
      updatedAt: req.page.updated_at,
    });
  }

  const t = now();
  db.prepare('UPDATE pages SET content = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(
    JSON.stringify({ elements: content.elements }),
    t,
    req.user.id,
    req.page.id
  );
  touchPaper(req.paper.id);
  const row = db
    .prepare('SELECT p.*, u.display_name AS updated_by_name FROM pages p LEFT JOIN users u ON u.id = p.updated_by WHERE p.id = ?')
    .get(req.page.id);
  res.json({ page: serializePage(row) });
});

router.delete('/pages/:pid', withPageForEdit, (req, res) => {
  db.prepare('DELETE FROM pages WHERE id = ?').run(req.page.id);
  touchPaper(req.paper.id);
  res.json({ ok: true });
});

/* ---------- Sharing ---------- */

const listShares = (paperId) =>
  db
    .prepare(
      `SELECT s.user_id AS id, u.username, u.display_name AS displayName, s.role
       FROM shares s JOIN users u ON u.id = s.user_id WHERE s.newspaper_id = ? ORDER BY u.username`
    )
    .all(paperId);

router.get('/papers/:id/shares', withPaper('owner'), (req, res) => {
  res.json({ shares: listShares(req.paper.id) });
});

router.post('/papers/:id/shares', withPaper('owner'), (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase().replace(/^@/, '');
  const role = req.body.role === 'edit' ? 'edit' : 'view';
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: `No user called @${username}` });
  if (user.id === req.user.id) return res.status(400).json({ error: 'You already own this newspaper' });
  db.prepare(
    `INSERT INTO shares (newspaper_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (newspaper_id, user_id) DO UPDATE SET role = excluded.role`
  ).run(req.paper.id, user.id, role, now());
  res.json({ shares: listShares(req.paper.id) });
});

// Owner removes someone, or a collaborator leaves a shared paper.
router.delete('/papers/:id/shares/:uid', withPaper('view'), (req, res) => {
  const uid = Number(req.params.uid);
  if (req.role !== 'owner' && uid !== req.user.id) return res.status(403).json({ error: 'Only the owner can do that' });
  db.prepare('DELETE FROM shares WHERE newspaper_id = ? AND user_id = ?').run(req.paper.id, uid);
  res.json({ shares: req.role === 'owner' ? listShares(req.paper.id) : [] });
});

module.exports = router;
