// In-app notifications (the bell) + matching emails.
const db = require('./db');
const { sendLater, layout } = require('./mailer');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Public base URL used in email links. Set APP_URL in production
// (e.g. https://dumi-news.onrender.com); otherwise we use the request's host.
function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

async function insert({ userId, type, actorId, paperId, day = null, data = {} }) {
  await db.query(
    `INSERT INTO notifications (user_id, type, actor_id, newspaper_id, day, data, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [userId, type, actorId, paperId, day, JSON.stringify(data)]
  );
}

async function emailTarget(userId) {
  const { rows } = await db.query('SELECT email, notify_email, display_name FROM users WHERE id = $1', [userId]);
  const u = rows[0];
  return u && u.email && u.notify_email ? u : null;
}

// Someone shared a newspaper with `userId`.
async function shared(req, { userId, paper, role }) {
  const actor = req.user;
  const monthName = `${MONTHS[paper.month - 1]} ${paper.year}`;
  await insert({ userId, type: 'share', actorId: actor.id, paperId: paper.id, data: { role, title: paper.title } });

  const to = await emailTarget(userId);
  if (!to) return;
  const url = `${baseUrl(req)}/paper?id=${paper.id}`;
  const access = role === 'edit' ? 'read and write in it' : 'read it';
  const body = `${actor.display_name} (@${actor.username}) shared "${paper.title}" for ${monthName} with you. You can ${access}. It is waiting under "Shared with me" on your shelf.`;
  sendLater({
    to: to.email,
    subject: `${actor.display_name} shared "${paper.title}" with you`,
    text: `${body}\n\nOpen it: ${url}`,
    html: layout({ kicker: 'Hot off the press', headline: `${actor.display_name} shared a newspaper with you`, body, cta: 'Read it now', url }),
  });
}

// Someone's access changed (in-app only; no email for this).
async function roleChanged(req, { userId, paper, role }) {
  await insert({ userId, type: 'role', actorId: req.user.id, paperId: paper.id, data: { role, title: paper.title } });
}

// Someone reacted to a page. `first` = this is their first reaction on that page
// (changing an emoji later updates the bell but does not send another email).
async function reacted(req, { userId, paper, day, emoji, first }) {
  const actor = req.user;
  // Keep one bell entry per (reader, page): replace any older unread one.
  await db.query(
    `DELETE FROM notifications
     WHERE user_id = $1 AND actor_id = $2 AND newspaper_id = $3 AND day = $4 AND type = 'reaction' AND read_at IS NULL`,
    [userId, actor.id, paper.id, day]
  );
  await insert({ userId, type: 'reaction', actorId: actor.id, paperId: paper.id, day, data: { emoji, title: paper.title } });

  if (!first) return;
  const to = await emailTarget(userId);
  if (!to) return;
  const dateStr = `${MONTHS[paper.month - 1]} ${day}`;
  const url = `${baseUrl(req)}/paper?id=${paper.id}&day=${day}`;
  const body = `${actor.display_name} (@${actor.username}) read your ${dateStr} page in "${paper.title}" and reacted ${emoji}.`;
  sendLater({
    to: to.email,
    subject: `${actor.display_name} reacted ${emoji} to your ${dateStr} page`,
    text: `${body}\n\nSee the page: ${url}`,
    html: layout({ kicker: 'Letters to the editor', headline: `${emoji} from ${actor.display_name}`, body, cta: 'See your page', url }),
  });
}

async function reactionRemoved({ userId, actorId, paperId, day }) {
  await db.query(
    `DELETE FROM notifications
     WHERE user_id = $1 AND actor_id = $2 AND newspaper_id = $3 AND day = $4 AND type = 'reaction' AND read_at IS NULL`,
    [userId, actorId, paperId, day]
  );
}

module.exports = { shared, roleChanged, reacted, reactionRemoved };
