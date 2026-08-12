const express = require('express');
const router = express.Router();
const { getUnreadCount, getUnreadMessages, getInboxFolderRaw } = require('../lib/emailInbox');

function requireAdminKey(req, res, next) {
  const configuredKey = process.env.ADMIN_API_KEY;

  if (!configuredKey) {
    return res.status(503).json({
      error: 'ADMIN_API_KEY is not configured on the server, so this endpoint is disabled for safety.',
    });
  }

  const providedKey = req.get('x-admin-key');
  if (providedKey !== configuredKey) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  next();
}

router.use(requireAdminKey);

// GET /api/email/test-connection
// Confirms the Graph API connection works at all - just an unread count.
router.get('/test-connection', async (req, res) => {
  try {
    const unreadCount = await getUnreadCount();
    res.json({ success: true, unreadCount });
  } catch (err) {
    console.error('Email connection test failed:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Connection failed.',
      details: err.response?.data || err.message,
    });
  }
});

// GET /api/email/preview
// Shows the actual unread messages, without doing anything to them - a safe
// way to confirm real mail is being read correctly.
router.get('/preview', async (req, res) => {
  try {
    const messages = await getUnreadMessages({ top: 5 });
    res.json({
      messages: messages.map((m) => ({
        id: m.id,
        subject: m.subject,
        from: m.from?.emailAddress?.address,
        preview: m.bodyPreview,
        receivedDateTime: m.receivedDateTime,
      })),
    });
  } catch (err) {
    console.error('Email preview failed:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Preview failed.',
      details: err.response?.data || err.message,
    });
  }
});

// GET /api/email/test-connection-raw
// Same idea as test-connection, but with zero OData query parameters -
// isolates whether $select specifically is what's being blocked.
router.get('/test-connection-raw', async (req, res) => {
  try {
    const folder = await getInboxFolderRaw();
    res.json({ success: true, folder });
  } catch (err) {
    console.error('Raw email connection test failed:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Connection failed.',
      details: err.response?.data || err.message,
    });
  }
});

module.exports = router;
