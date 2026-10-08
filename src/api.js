// Newspapers (months), pages (days) and sharing.
const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const notify = require('./notify');

const router = express.Router();
router.use(requireAuth);

const now = () => new Date().toISOString();
const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
const canEdit = (role) => role === 'owner' || role === 'edit';
const MAX_CONTENT_BYTES = 20 * 1024 * 1024;
const REACTIONS = ['❤️', '😂', '😮', '😢', '👏', '☕'];

/*
 * PostgreSQL returns TIMESTAMPTZ columns as JavaScript Date objects.
 * The old SQLite application used ISO strings, so normalize timestamps
 * before sending them to the frontend or comparing them.
 */
const isoTimestamp = (value) => {
  if (!value) return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

const PAPER_SELECT = `
  SELECT n.*, u.username AS owner_username, u.display_name AS owner_name,
         (SELECT COUNT(*) FROM pages p WHERE p.newspaper_id = n.id) AS page_count
  FROM newspapers n
  JOIN users u ON u.id = n.owner_id
`;

function serializePaper(row, role) {
  return {
    id: Number(row.id),
    title: row.title,
    year: Number(row.year),
    month: Number(row.month),
    ownerId: Number(row.owner_id),
    ownerUsername: row.owner_username,
    ownerName: row.owner_name,
    pageCount: Number(row.page_count),
    updatedAt: isoTimestamp(row.updated_at),
    role,
  };
}

function serializePage(row) {
  return {
    id: Number(row.id),
    day: Number(row.day),
    content: typeof row.content === 'string' ? JSON.parse(row.content) : row.content,
    updatedAt: isoTimestamp(row.updated_at),
    updatedBy: row.updated_by_name || null,
  };
}

/*
 * Find a newspaper and determine the current user's role.
 *
 * Returns:
 *   { paper: null, role: null } if newspaper doesn't exist
 *   { paper, role: 'owner' } for owner
 *   { paper, role: 'view' } for viewer
 *   { paper, role: 'edit' } for editor
 *   { paper, role: null } if user has no access
 */
async function roleFor(paperId, userId) {
  const paperResult = await db.query(
    `${PAPER_SELECT} WHERE n.id = $1`,
    [paperId]
  );

  const paper = paperResult.rows[0];

  if (!paper) {
    return { paper: null, role: null };
  }

  if (String(paper.owner_id) === String(userId)) {
    return { paper, role: 'owner' };
  }

  const shareResult = await db.query(
    `
    SELECT role
    FROM shares
    WHERE newspaper_id = $1 AND user_id = $2
    `,
    [paperId, userId]
  );

  const share = shareResult.rows[0];

  return {
    paper,
    role: share ? share.role : null
  };
}


// Middleware: load newspaper :id and enforce a minimum role.
function withPaper(minRole) {
  return async (req, res, next) => {
    try {
      const { paper, role } = await roleFor(
        Number(req.params.id),
        req.user.id
      );

      if (!paper || !role) {
        return res.status(404).json({
          error: 'Newspaper not found'
        });
      }

      if (minRole === 'edit' && !canEdit(role)) {
        return res.status(403).json({
          error: 'You only have view access'
        });
      }

      if (minRole === 'owner' && role !== 'owner') {
        return res.status(403).json({
          error: 'Only the owner can do that'
        });
      }

      req.paper = paper;
      req.role = role;

      next();
    } catch (error) {
      console.error('withPaper error:', error);
      res.status(500).json({
        error: 'Unable to load newspaper'
      });
    }
  };
}


// Middleware: load page :pid and its newspaper, enforcing a minimum role.
const withPageForEdit = withPage('edit');

function withPage(minRole) {
  return async (req, res, next) => {
  try {
    const pageResult = await db.query(
      'SELECT * FROM pages WHERE id = $1',
      [Number(req.params.pid)]
    );

    const page = pageResult.rows[0];

    if (!page) {
      return res.status(404).json({
        error: 'Page not found'
      });
    }

    const { paper, role } = await roleFor(
      page.newspaper_id,
      req.user.id
    );

    if (!paper || !role) {
      return res.status(404).json({
        error: 'Page not found'
      });
    }

    if (minRole === 'edit' && !canEdit(role)) {
      return res.status(403).json({
        error: 'You only have view access'
      });
    }

    req.page = page;
    req.paper = paper;
    req.role = role;

    next();
  } catch (error) {
    console.error('withPage error:', error);

    res.status(500).json({
      error: 'Unable to load page'
    });
  }
  };
}


function validateContent(content) {
  if (
    !content ||
    typeof content !== 'object' ||
    !Array.isArray(content.elements)
  ) {
    return 'Invalid page content';
  }

  if (content.elements.length > 300) {
    return 'Too many elements on one page';
  }

  const json = JSON.stringify({
    elements: content.elements
  });

  if (Buffer.byteLength(json) > MAX_CONTENT_BYTES) {
    return 'Page is too large (try smaller images)';
  }

  return null;
}


async function touchPaper(id) {
  await db.query(
    'UPDATE newspapers SET updated_at = $1 WHERE id = $2',
    [now(), id]
  );
}


/* ---------- Newspapers ---------- */


// Get user's newspapers and shared newspapers.
router.get('/papers', async (req, res) => {
  try {
    const mineResult = await db.query(
      `
      ${PAPER_SELECT}
      WHERE n.owner_id = $1
      ORDER BY n.year DESC, n.month DESC
      `,
      [req.user.id]
    );

    const mine = mineResult.rows.map((row) =>
      serializePaper(row, 'owner')
    );


    const sharedResult = await db.query(
      `
      ${PAPER_SELECT.replace(
        'FROM newspapers n',
        'FROM newspapers n JOIN shares s ON s.newspaper_id = n.id'
      )}
      WHERE s.user_id = $1
      ORDER BY n.year DESC, n.month DESC
      `,
      [req.user.id]
    );


    const rolesResult = await db.query(
      `
      SELECT newspaper_id, role
      FROM shares
      WHERE user_id = $1
      `,
      [req.user.id]
    );

    const roleMap = Object.fromEntries(
      rolesResult.rows.map((row) => [
        String(row.newspaper_id),
        row.role
      ])
    );


    const shared = sharedResult.rows.map((row) =>
      serializePaper(
        row,
        roleMap[String(row.id)]
      )
    );


    // Days you actually wrote something on (any text or photo) in the last ~400 days.
    // The browser turns this into a writing streak using its own local date.
    const daysResult = await db.query(
      `
      SELECT n.year, n.month, p.day
      FROM pages p
      JOIN newspapers n ON n.id = p.newspaper_id
      WHERE n.owner_id = $1
        AND make_date(n.year::int, n.month::int, 1) >= (current_date - INTERVAL '400 days')
        AND p.content::text ~ '"(html|src)":"[^"]'
      `,
      [req.user.id]
    );

    const writtenDays = daysResult.rows.map((r) =>
      `${r.year}-${String(r.month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`
    );

    res.json({
      mine,
      shared,
      writtenDays
    });

  } catch (error) {
    console.error('Get papers error:', error);

    res.status(500).json({
      error: 'Unable to load newspapers'
    });
  }
});


// Create newspaper.
router.post('/papers', async (req, res) => {
  const year = Number(req.body.year);
  const month = Number(req.body.month);

  const title =
    String(req.body.title || '')
      .trim()
      .slice(0, 60) ||
    `The ${req.user.display_name} Times`;


  if (
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 2200
  ) {
    return res.status(400).json({
      error: 'Invalid year'
    });
  }


  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return res.status(400).json({
      error: 'Invalid month'
    });
  }


  try {
    const t = now();

    const result = await db.query(
      `
      INSERT INTO newspapers
        (owner_id, title, year, month, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6)
      RETURNING id
      `,
      [
        req.user.id,
        title,
        year,
        month,
        t,
        t
      ]
    );


    const newspaperId = result.rows[0].id;


    const paperResult = await db.query(
      `${PAPER_SELECT} WHERE n.id = $1`,
      [newspaperId]
    );


    const row = paperResult.rows[0];


    res.status(201).json({
      paper: serializePaper(row, 'owner')
    });

  } catch (error) {
    console.error('Create newspaper error:', error);

    // PostgreSQL unique violation
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'You already have a newspaper for that month'
      });
    }

    res.status(500).json({
      error: 'Unable to create newspaper'
    });
  }
});


// Get one newspaper and all its pages.
router.get('/papers/:id', withPaper('view'), async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT
        p.*,
        u.display_name AS updated_by_name
      FROM pages p
      LEFT JOIN users u ON u.id = p.updated_by
      WHERE p.newspaper_id = $1
      ORDER BY p.day
      `,
      [req.paper.id]
    );


    const pages = result.rows.map(serializePage);

    const reactionsResult = await db.query(
      `
      SELECT r.page_id, r.user_id, r.emoji, u.display_name, u.username
      FROM reactions r
      JOIN pages p ON p.id = r.page_id
      JOIN users u ON u.id = r.user_id
      WHERE p.newspaper_id = $1
      ORDER BY r.updated_at DESC
      `,
      [req.paper.id]
    );

    const byPage = {};
    for (const r of reactionsResult.rows) {
      (byPage[r.page_id] ||= []).push(r);
    }
    pages.forEach((pg) => {
      pg.reactions = summarizeReactions(byPage[pg.id] || [], req.user.id);
    });


    res.json({
      paper: serializePaper(req.paper, req.role),
      pages,
      reactionChoices: REACTIONS
    });

  } catch (error) {
    console.error('Get newspaper error:', error);

    res.status(500).json({
      error: 'Unable to load newspaper'
    });
  }
});


// Rename newspaper.
router.patch('/papers/:id', withPaper('edit'), async (req, res) => {
  const title =
    String(req.body.title || '')
      .trim()
      .slice(0, 60);


  if (!title) {
    return res.status(400).json({
      error: 'Title cannot be empty'
    });
  }


  try {
    await db.query(
      `
      UPDATE newspapers
      SET title = $1, updated_at = $2
      WHERE id = $3
      `,
      [
        title,
        now(),
        req.paper.id
      ]
    );


    res.json({
      ok: true,
      title
    });

  } catch (error) {
    console.error('Rename newspaper error:', error);

    res.status(500).json({
      error: 'Unable to update newspaper'
    });
  }
});


// Delete newspaper.
router.delete('/papers/:id', withPaper('owner'), async (req, res) => {
  try {
    // Delete children explicitly, in one transaction, so this works even if the
    // Supabase foreign keys were created without ON DELETE CASCADE.
    await db.tx(async (c) => {
      const id = req.paper.id;
      await c.query('DELETE FROM notifications WHERE newspaper_id = $1', [id]);
      await c.query('DELETE FROM reactions WHERE page_id IN (SELECT id FROM pages WHERE newspaper_id = $1)', [id]);
      await c.query('DELETE FROM shares WHERE newspaper_id = $1', [id]);
      await c.query('DELETE FROM pages WHERE newspaper_id = $1', [id]);
      await c.query('DELETE FROM newspapers WHERE id = $1', [id]);
    });


    res.json({
      ok: true
    });

  } catch (error) {
    console.error('Delete newspaper error:', error);

    res.status(500).json({
      error: 'Unable to delete newspaper'
    });
  }
});


/* ---------- Pages ---------- */


// Create a page.
router.post('/papers/:id/pages', withPaper('edit'), async (req, res) => {
  const day = Number(req.body.day);

  const max = daysInMonth(
    req.paper.year,
    req.paper.month
  );


  if (
    !Number.isInteger(day) ||
    day < 1 ||
    day > max
  ) {
    return res.status(400).json({
      error: `Day must be between 1 and ${max}`
    });
  }


  const content =
    req.body.content || {
      elements: []
    };


  const err = validateContent(content);

  if (err) {
    return res.status(400).json({
      error: err
    });
  }


  try {
    const t = now();

    const result = await db.query(
      `
      INSERT INTO pages
        (newspaper_id, day, content, updated_at, updated_by)
      VALUES
        ($1, $2, $3, $4, $5)
      RETURNING id
      `,
      [
        req.paper.id,
        day,
        JSON.stringify({
          elements: content.elements
        }),
        t,
        req.user.id
      ]
    );


    const pageId = result.rows[0].id;


    await touchPaper(req.paper.id);


    const pageResult = await db.query(
      `
      SELECT
        p.*,
        u.display_name AS updated_by_name
      FROM pages p
      LEFT JOIN users u ON u.id = p.updated_by
      WHERE p.id = $1
      `,
      [pageId]
    );


    const row = pageResult.rows[0];


    res.status(201).json({
      page: serializePage(row)
    });

  } catch (error) {
    console.error('Create page error:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        error: 'That day already has a page'
      });
    }

    res.status(500).json({
      error: 'Unable to create page'
    });
  }
});


// Save a page.
//
// "Save & refresh" collaboration:
// if someone else saved since you loaded the page
// (baseUpdatedAt mismatch), return 409 unless force=true.
router.put('/pages/:pid', withPageForEdit, async (req, res) => {
  const {
    content,
    baseUpdatedAt,
    force
  } = req.body;


  const err = validateContent(content);

  if (err) {
    return res.status(400).json({
      error: err
    });
  }


  const currentUpdatedAt = isoTimestamp(
    req.page.updated_at
  );


  if (
    !force &&
    baseUpdatedAt &&
    baseUpdatedAt !== currentUpdatedAt
  ) {
    try {
      const whoResult = await db.query(
        `
        SELECT display_name
        FROM users
        WHERE id = $1
        `,
        [req.page.updated_by]
      );


      const who = whoResult.rows[0];


      return res.status(409).json({
        error: 'This page was changed by someone else since you opened it',
        conflict: true,
        updatedBy: who
          ? who.display_name
          : 'someone',
        updatedAt: currentUpdatedAt,
      });

    } catch (error) {
      console.error('Conflict lookup error:', error);

      return res.status(500).json({
        error: 'Unable to check page conflict'
      });
    }
  }


  try {
    const t = now();


    await db.query(
      `
      UPDATE pages
      SET
        content = $1,
        updated_at = $2,
        updated_by = $3
      WHERE id = $4
      `,
      [
        JSON.stringify({
          elements: content.elements
        }),
        t,
        req.user.id,
        req.page.id
      ]
    );


    await touchPaper(req.paper.id);


    const result = await db.query(
      `
      SELECT
        p.*,
        u.display_name AS updated_by_name
      FROM pages p
      LEFT JOIN users u ON u.id = p.updated_by
      WHERE p.id = $1
      `,
      [req.page.id]
    );


    const row = result.rows[0];


    res.json({
      page: serializePage(row)
    });

  } catch (error) {
    console.error('Update page error:', error);

    res.status(500).json({
      error: 'Unable to save page'
    });
  }
});


// Delete page.
router.delete('/pages/:pid', withPageForEdit, async (req, res) => {
  try {
    await db.tx(async (c) => {
      await c.query('DELETE FROM reactions WHERE page_id = $1', [req.page.id]);
      await c.query(
        'DELETE FROM notifications WHERE newspaper_id = $1 AND day = $2',
        [req.paper.id, req.page.day]
      );
      await c.query('DELETE FROM pages WHERE id = $1', [req.page.id]);
    });


    await touchPaper(req.paper.id);


    res.json({
      ok: true
    });

  } catch (error) {
    console.error('Delete page error:', error);

    res.status(500).json({
      error: 'Unable to delete page'
    });
  }
});


/* ---------- Sharing ---------- */


async function listShares(paperId) {
  const result = await db.query(
    `
    SELECT
      s.user_id AS id,
      u.username,
      u.display_name AS "displayName",
      s.role
    FROM shares s
    JOIN users u ON u.id = s.user_id
    WHERE s.newspaper_id = $1
    ORDER BY u.username
    `,
    [paperId]
  );

  return result.rows;
}


// List collaborators.
router.get('/papers/:id/shares', withPaper('owner'), async (req, res) => {
  try {
    const shares = await listShares(req.paper.id);

    res.json({
      shares
    });

  } catch (error) {
    console.error('List shares error:', error);

    res.status(500).json({
      error: 'Unable to load shares'
    });
  }
});


// Add or update collaborator.
router.post('/papers/:id/shares', withPaper('owner'), async (req, res) => {
  const username =
    String(req.body.username || '')
      .trim()
      .toLowerCase()
      .replace(/^@/, '');


  const role =
    req.body.role === 'edit'
      ? 'edit'
      : 'view';


  try {
    const userResult = await db.query(
      `
      SELECT id
      FROM users
      WHERE username = $1
      `,
      [username]
    );


    const user = userResult.rows[0];


    if (!user) {
      return res.status(404).json({
        error: `No user called @${username}`
      });
    }


    if (String(user.id) === String(req.user.id)) {
      return res.status(400).json({
        error: 'You already own this newspaper'
      });
    }


    const before = await db.query(
      'SELECT role FROM shares WHERE newspaper_id = $1 AND user_id = $2',
      [req.paper.id, user.id]
    );
    const previousRole = before.rows[0] ? before.rows[0].role : null;

    await db.query(
      `
      INSERT INTO shares
        (newspaper_id, user_id, role, created_at)
      VALUES
        ($1, $2, $3, $4)
      ON CONFLICT (newspaper_id, user_id)
      DO UPDATE SET role = EXCLUDED.role
      `,
      [
        req.paper.id,
        user.id,
        role,
        now()
      ]
    );

    // Bell + email for a new share; bell only when access changes.
    try {
      if (!previousRole) {
        await notify.shared(req, { userId: user.id, paper: req.paper, role });
      } else if (previousRole !== role) {
        await notify.roleChanged(req, { userId: user.id, paper: req.paper, role });
      }
    } catch (e) {
      console.error('Share notification error:', e);
    }


    const shares = await listShares(req.paper.id);


    res.json({
      shares
    });

  } catch (error) {
    console.error('Add share error:', error);

    res.status(500).json({
      error: 'Unable to update sharing'
    });
  }
});


// Owner removes someone, or a collaborator leaves a shared paper.
router.delete(
  '/papers/:id/shares/:uid',
  withPaper('view'),
  async (req, res) => {
    const uid = Number(req.params.uid);


    if (
      req.role !== 'owner' &&
      uid !== Number(req.user.id)
    ) {
      return res.status(403).json({
        error: 'Only the owner can do that'
      });
    }


    try {
      await db.query(
        `
        DELETE FROM shares
        WHERE newspaper_id = $1
          AND user_id = $2
        `,
        [
          req.paper.id,
          uid
        ]
      );


      const shares =
        req.role === 'owner'
          ? await listShares(req.paper.id)
          : [];


      res.json({
        shares
      });

    } catch (error) {
      console.error('Delete share error:', error);

      res.status(500).json({
        error: 'Unable to update sharing'
      });
    }
  }
);


/* ---------- Reactions ---------- */


function summarizeReactions(rows, meId) {
  const counts = {};
  let mine = null;
  const people = [];
  for (const r of rows) {
    counts[r.emoji] = (counts[r.emoji] || 0) + 1;
    if (String(r.user_id) === String(meId)) mine = r.emoji;
    people.push({ name: r.display_name, username: r.username, emoji: r.emoji });
  }
  return { counts, mine, people };
}

async function pageReactions(pageId, meId) {
  const { rows } = await db.query(
    `
    SELECT r.user_id, r.emoji, u.display_name, u.username
    FROM reactions r JOIN users u ON u.id = r.user_id
    WHERE r.page_id = $1
    ORDER BY r.updated_at DESC
    `,
    [pageId]
  );
  return summarizeReactions(rows, meId);
}


// React to a page (anyone who can see it). Sending the same emoji again keeps it.
router.put('/pages/:pid/reaction', withPage('view'), async (req, res) => {
  const emoji = String(req.body.emoji || '');

  if (!REACTIONS.includes(emoji)) {
    return res.status(400).json({ error: 'Unknown reaction' });
  }

  try {
    const result = await db.query(
      `
      INSERT INTO reactions (page_id, user_id, emoji, created_at, updated_at)
      VALUES ($1, $2, $3, now(), now())
      ON CONFLICT (page_id, user_id)
      DO UPDATE SET emoji = EXCLUDED.emoji, updated_at = now()
      RETURNING (xmax = 0) AS inserted
      `,
      [req.page.id, req.user.id, emoji]
    );

    const first = result.rows[0].inserted;
    const ownerId = req.paper.owner_id;

    if (String(ownerId) !== String(req.user.id)) {
      notify
        .reacted(req, { userId: ownerId, paper: req.paper, day: req.page.day, emoji, first })
        .catch((e) => console.error('Reaction notification error:', e));
    }

    res.json({ reactions: await pageReactions(req.page.id, req.user.id) });
  } catch (error) {
    console.error('React error:', error);
    res.status(500).json({ error: 'Unable to save your reaction' });
  }
});


// Take your reaction back.
router.delete('/pages/:pid/reaction', withPage('view'), async (req, res) => {
  try {
    await db.query('DELETE FROM reactions WHERE page_id = $1 AND user_id = $2', [req.page.id, req.user.id]);

    notify
      .reactionRemoved({ userId: req.paper.owner_id, actorId: req.user.id, paperId: req.paper.id, day: req.page.day })
      .catch((e) => console.error('Reaction notification cleanup error:', e));

    res.json({ reactions: await pageReactions(req.page.id, req.user.id) });
  } catch (error) {
    console.error('Unreact error:', error);
    res.status(500).json({ error: 'Unable to remove your reaction' });
  }
});


/* ---------- Notifications (the bell) ---------- */


router.get('/notifications', async (req, res) => {
  try {
    const { rows } = await db.query(
      `
      SELECT n.id, n.type, n.newspaper_id, n.day, n.data, n.read_at, n.created_at,
             u.display_name AS actor_name, u.username AS actor_username,
             np.title AS paper_title, np.month, np.year
      FROM notifications n
      LEFT JOIN users u ON u.id = n.actor_id
      LEFT JOIN newspapers np ON np.id = n.newspaper_id
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC
      LIMIT 40
      `,
      [req.user.id]
    );

    const unreadResult = await db.query(
      'SELECT COUNT(*) AS c FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [req.user.id]
    );

    res.json({
      unread: Number(unreadResult.rows[0].c),
      items: rows.map((r) => ({
        id: Number(r.id),
        type: r.type,
        paperId: r.newspaper_id ? Number(r.newspaper_id) : null,
        paperTitle: r.paper_title || (r.data && r.data.title) || 'a newspaper',
        month: r.month,
        year: r.year,
        day: r.day,
        data: r.data || {},
        actorName: r.actor_name || 'Someone',
        actorUsername: r.actor_username,
        read: !!r.read_at,
        createdAt: isoTimestamp(r.created_at),
      })),
    });
  } catch (error) {
    console.error('Notifications error:', error);
    res.status(500).json({ error: 'Unable to load notifications' });
  }
});


// Mark notifications as read: { ids: [1,2] } or {} for all.
router.post('/notifications/read', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
    if (ids && ids.length) {
      await db.query(
        'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL',
        [req.user.id, ids]
      );
    } else {
      await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Unable to update notifications' });
  }
});


module.exports = router;