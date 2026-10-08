// Idempotent schema setup. Runs on every server start; safe to run many times.
// It only ADDS things (tables, columns, indexes) and never drops your data.
// The same SQL lives in db/schema.sql if you prefer to paste it into the
// Supabase SQL editor yourself.
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await db.query(sql);
  console.log('✓ Database schema is up to date');
}

module.exports = migrate;
