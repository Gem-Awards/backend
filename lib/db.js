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

const ALLOWED_STATUSES = ['ai_active', 'escalated', 'awaiting_email', 'closed'];

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

  // Added after the initial launch - IF NOT EXISTS makes this safe to run
  // again on a database that already has the conversations table.
  await pool.query(`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_name TEXT;
  `);

  // NULL = unread/needs attention. Set when someone views it in Live Chats,
  // and reset to NULL whenever the customer sends a new message.
  await pool.query(`
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;
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

async function createConversation({ id, channel, customerEmail, customerName }) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO conversations (id, channel, customer_email, customer_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [id, channel, customerEmail || null, customerName || null]
  );
}

async function saveMessage({ id, conversationId, sender, content, escalate, conversationStatus }) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO messages (id, conversation_id, sender, content, escalate)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, conversationId, sender, content, !!escalate]
  );
  const statusToSet = conversationStatus || (escalate ? 'escalated' : 'ai_active');

  if (sender === 'customer') {
    // New customer activity - mark unread again so it surfaces for your team.
    await pool.query(
      `UPDATE conversations SET updated_at = now(), status = $2, viewed_at = NULL WHERE id = $1`,
      [conversationId, statusToSet]
    );
  } else {
    await pool.query(
      `UPDATE conversations SET updated_at = now(), status = $2 WHERE id = $1`,
      [conversationId, statusToSet]
    );
  }
}

async function markConversationViewed(conversationId) {
  if (!pool) return;
  await pool.query('UPDATE conversations SET viewed_at = now() WHERE id = $1', [conversationId]);
}

async function countUnreadConversations() {
  if (!pool) return 0;
  const res = await pool.query(
    `SELECT COUNT(*) FROM conversations WHERE viewed_at IS NULL AND status IN ('escalated', 'awaiting_email')`
  );
  return parseInt(res.rows[0].count, 10) || 0;
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

async function getConversationStatus(conversationId) {
  if (!pool) return null;
  const res = await pool.query('SELECT status FROM conversations WHERE id = $1', [
    conversationId,
  ]);
  return res.rows.length ? res.rows[0].status : null;
}

async function updateConversationStatus(conversationId, status) {
  if (!pool) return false;
  if (!ALLOWED_STATUSES.includes(status)) return false;
  await pool.query('UPDATE conversations SET status = $2, updated_at = now() WHERE id = $1', [
    conversationId,
    status,
  ]);
  return true;
}

async function getConversationEmail(conversationId) {
  if (!pool) return null;
  const res = await pool.query('SELECT customer_email FROM conversations WHERE id = $1', [
    conversationId,
  ]);
  return res.rows.length ? res.rows[0].customer_email : null;
}

async function updateConversationEmail(conversationId, email) {
  if (!pool) return;
  await pool.query(
    'UPDATE conversations SET customer_email = $2, updated_at = now() WHERE id = $1',
    [conversationId, email]
  );
}

async function listConversations({ status, search, sort } = {}) {
  if (!pool) return [];

  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(customer_email ILIKE $${params.length} OR customer_name ILIKE $${params.length})`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const direction = sort === 'asc' ? 'ASC' : 'DESC';

  const query = `SELECT * FROM conversations ${whereClause} ORDER BY updated_at ${direction} LIMIT 50`;
  const res = await pool.query(query, params);
  return res.rows;
}

module.exports = {
  pool,
  initDb,
  createConversation,
  saveMessage,
  getConversation,
  getConversationStatus,
  updateConversationStatus,
  getConversationEmail,
  updateConversationEmail,
  markConversationViewed,
  countUnreadConversations,
  listConversations,
};
