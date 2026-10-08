const { Pool, types } = require('pg');
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined in .env');
}

// Supabase tables usually use BIGINT (int8) ids, and COUNT(*) is also int8.
// node-postgres returns int8 as a *string* by default ("12" instead of 12),
// which broke strict comparisons on the frontend (e.g. deleting a newspaper).
// Our ids and counts are far below 2^53, so parse them as normal numbers.
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase needs SSL. Set DB_SSL=false for a local Postgres without SSL.
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => console.error('Postgres pool error:', err.message));

// Run several queries in one transaction: await db.tx(async (c) => { await c.query(...) })
pool.tx = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

module.exports = pool;
