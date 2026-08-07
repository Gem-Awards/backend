const { Pool } = require('pg');

let pool = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
} else {
  console.warn(
    'DATABASE_URL is not set - conversation history will not be saved. ' +
      'Fine for quick local testing, but required before using the conversations/dashboard features.'
  );
}

async function initDb() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL DEFAULT 'chat',
      customer_email TEXT,
      status TEXT NOT NULL DEFAULT 'ai_active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      sender TEXT NOT NULL,
      content TEXT NOT NULL,
      escalate BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  console.log('Database ready: conversations and messages tables exist.');
}

async function createConversation({ id, channel, customerEmail }) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO conversations (id, channel, customer_email)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [id, channel, customerEmail || null]
  );
}

async function saveMessage({ id, conversationId, sender, content, escalate }) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO messages (id, conversation_id, sender, content, escalate)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, conversationId, sender, content, !!escalate]
  );
  await pool.query(
    `UPDATE conversations SET updated_at = now(), status = $2 WHERE id = $1`,
    [conversationId, escalate ? 'escalated' : 'ai_active']
  );
}

async function getConversation(conversationId) {
  if (!pool) return null;
  const convRes = await pool.query('SELECT * FROM conversations WHERE id = $1', [
    conversationId,
  ]);
  if (convRes.rows.length === 0) return null;

  const msgRes = await pool.query(
    'SELECT sender, content, escalate, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
    [conversationId]
  );

  return { ...convRes.rows[0], messages: msgRes.rows };
}

async function listConversations({ status } = {}) {
  if (!pool) return [];
  const query = status
    ? 'SELECT * FROM conversations WHERE status = $1 ORDER BY updated_at DESC LIMIT 50'
    : 'SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 50';
  const params = status ? [status] : [];
  const res = await pool.query(query, params);
  return res.rows;
}

module.exports = {
  pool,
  initDb,
  createConversation,
  saveMessage,
  getConversation,
  listConversations,
};
