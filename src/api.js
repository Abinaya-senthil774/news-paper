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
    id: row.id,
    title: row.title,
    year: row.year,
    month: row.month,
    ownerId: row.owner_id,
    ownerUsername: row.owner_username,
    ownerName: row.owner_name,
    pageCount: row.page_count,
    updatedAt: isoTimestamp(row.updated_at),
    role,
  };
}

function serializePage(row) {
  return {
    id: row.id,
    day: row.day,
    content: JSON.parse(row.content),
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


// Middleware: load page :pid and its newspaper; requires edit access.
async function withPageForEdit(req, res, next) {
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

    if (!canEdit(role)) {
      return res.status(403).json({
        error: 'You only have view access'
      });
    }

    req.page = page;
    req.paper = paper;

    next();
  } catch (error) {
    console.error('withPageForEdit error:', error);

    res.status(500).json({
      error: 'Unable to load page'
    });
  }
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


    res.json({
      mine,
      shared
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


    res.json({
      paper: serializePaper(req.paper, req.role),
      pages
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
    await db.query(
      'DELETE FROM newspapers WHERE id = $1',
      [req.paper.id]
    );


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
    await db.query(
      'DELETE FROM pages WHERE id = $1',
      [req.page.id]
    );


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


module.exports = router;