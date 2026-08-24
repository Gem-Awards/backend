const express = require('express');
const router = express.Router();
const { getSetting, setSetting } = require('../lib/db');

const EMAIL_MODES = ['off', 'always', 'after_hours'];
const REPLY_MODES = ['send', 'draft'];

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

// GET /api/settings/email-mode
router.get('/email-mode', async (req, res) => {
  try {
    const mode = await getSetting('email_mode', 'always');
    res.json({ mode });
  } catch (err) {
    console.error('Failed to read email mode:', err.message);
    res.status(500).json({ error: 'Failed to read email mode.' });
  }
});

// POST /api/settings/email-mode
// body: { mode: 'off' | 'always' | 'after_hours' }
router.post('/email-mode', async (req, res) => {
  const { mode } = req.body;

  if (!EMAIL_MODES.includes(mode)) {
    return res.status(400).json({ error: `mode must be one of: ${EMAIL_MODES.join(', ')}` });
  }

  try {
    await setSetting('email_mode', mode);
    res.json({ success: true, mode });
  } catch (err) {
    console.error('Failed to save email mode:', err.message);
    res.status(500).json({ error: 'Failed to save email mode.' });
  }
});

// GET /api/settings/email-reply-mode
router.get('/email-reply-mode', async (req, res) => {
  try {
    const mode = await getSetting('email_reply_mode', 'send');
    res.json({ mode });
  } catch (err) {
    console.error('Failed to read email reply mode:', err.message);
    res.status(500).json({ error: 'Failed to read email reply mode.' });
  }
});

// POST /api/settings/email-reply-mode
// body: { mode: 'send' | 'draft' }
router.post('/email-reply-mode', async (req, res) => {
  const { mode } = req.body;

  if (!REPLY_MODES.includes(mode)) {
    return res.status(400).json({ error: `mode must be one of: ${REPLY_MODES.join(', ')}` });
  }

  try {
    await setSetting('email_reply_mode', mode);
    res.json({ success: true, mode });
  } catch (err) {
    console.error('Failed to save email reply mode:', err.message);
    res.status(500).json({ error: 'Failed to save email reply mode.' });
  }
});

module.exports = router;
