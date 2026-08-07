const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const {
  listConversations,
  getConversation,
  saveMessage,
  updateConversationStatus,
  markConversationViewed,
  countUnreadConversations,
  bulkCloseConversations,
} = require('../lib/db');

// Simple shared-secret protection. This data can include customer emails and
// full chat transcripts, so it should never be publicly readable. This is a
// placeholder - a real login system for your support team is the better
// long-term answer, but this keeps it from being wide open in the meantime.
function requireAdminKey(req, res, next) {
  const configuredKey = process.env.ADMIN_API_KEY;

  if (!configuredKey) {
    return res.status(503).json({
      error:
        'ADMIN_API_KEY is not configured on the server, so this endpoint is disabled for safety.',
    });
  }

  const providedKey = req.get('x-admin-key');
  if (providedKey !== configuredKey) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  next();
}

router.use(requireAdminKey);

// GET /api/conversations?status=escalated&search=jane&sort=asc
router.get('/', async (req, res) => {
  try {
    const conversations = await listConversations({
      status: req.query.status,
      search: req.query.search,
      sort: req.query.sort,
    });
    res.json({ conversations });
  } catch (err) {
    console.error('Failed to list conversations:', err.message);
    res.status(500).json({ error: 'Failed to load conversations.' });
  }
});

// GET /api/conversations/unread-count
// Must be registered before /:id below, or Express would treat
// "unread-count" as a conversation ID instead of matching this route.
router.get('/unread-count', async (req, res) => {
  try {
    const count = await countUnreadConversations();
    res.json({ count });
  } catch (err) {
    console.error('Failed to count unread conversations:', err.message);
    res.status(500).json({ error: 'Failed to count unread conversations.' });
  }
});

// GET /api/conversations/:id
// Viewing a conversation marks it as read.
router.get('/:id', async (req, res) => {
  try {
    const conversation = await getConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }
    await markConversationViewed(req.params.id);
    res.json({ conversation });
  } catch (err) {
    console.error('Failed to load conversation:', err.message);
    res.status(500).json({ error: 'Failed to load conversation.' });
  }
});

// POST /api/conversations/:id/reply
// body: { message }
// Saves a message from your support team, which the widget will pick up
// next time it polls (see routes/chat.js).
router.post('/:id/reply', async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    await saveMessage({
      id: crypto.randomUUID(),
      conversationId: req.params.id,
      sender: 'agent',
      content: message,
      escalate: false,
      conversationStatus: 'escalated',
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to save agent reply:', err.message);
    res.status(500).json({ error: 'Failed to save reply.' });
  }
});

// PATCH /api/conversations/:id/status
// body: { status } - one of: ai_active, escalated, awaiting_email, closed
router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;

  try {
    const updated = await updateConversationStatus(req.params.id, status);
    if (!updated) {
      return res.status(400).json({ error: 'Invalid or missing status value.' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to update conversation status:', err.message);
    res.status(500).json({ error: 'Failed to update status.' });
  }
});

// POST /api/conversations/bulk-close
// body: { ids: [...] }
router.post('/bulk-close', async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: 'ids must be a non-empty array.' });
  }

  try {
    const count = await bulkCloseConversations(ids);
    res.json({ success: true, count });
  } catch (err) {
    console.error('Failed to bulk-close conversations:', err.message);
    res.status(500).json({ error: 'Failed to bulk-close conversations.' });
  }
});

module.exports = router;
