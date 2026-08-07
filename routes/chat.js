const express = require('express');
const router = express.Router();
const { pool } = require('../lib/db');

// GET /api/chat/:id/messages
// Public (no admin key) - the widget polls this to check for agent replies
// while a conversation is escalated. Only returns sender/content/timestamp,
// never customer_email or anything else - and requires knowing the
// conversation's random ID, which is a reasonable (if not perfect) MVP
// safeguard since IDs aren't guessable or listed anywhere public.
router.get('/:id/messages', async (req, res) => {
  if (!pool) {
    return res.json({ messages: [] });
  }

  try {
    const result = await pool.query(
      'SELECT sender, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ messages: result.rows });
  } catch (err) {
    console.error('Failed to fetch chat messages:', err.message);
    res.status(500).json({ error: 'Failed to load messages.' });
  }
});

module.exports = router;
