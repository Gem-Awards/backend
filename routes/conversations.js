const express = require('express');
const router = express.Router();
const { listConversations, getConversation } = require('../lib/db');

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

// GET /api/conversations?status=escalated
router.get('/', async (req, res) => {
  try {
    const conversations = await listConversations({ status: req.query.status });
    res.json({ conversations });
  } catch (err) {
    console.error('Failed to list conversations:', err.message);
    res.status(500).json({ error: 'Failed to load conversations.' });
  }
});

// GET /api/conversations/:id
router.get('/:id', async (req, res) => {
  try {
    const conversation = await getConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }
    res.json({ conversation });
  } catch (err) {
    console.error('Failed to load conversation:', err.message);
    res.status(500).json({ error: 'Failed to load conversation.' });
  }
});

module.exports = router;
