require('dotenv').config();
const express = require('express');
const cors = require('cors');

const messageRoute = require('./routes/message');
const ordersRoute = require('./routes/orders');
const conversationsRoute = require('./routes/conversations');
const chatRoute = require('./routes/chat');
const emailRoute = require('./routes/email');
const settingsRoute = require('./routes/settings');
const { initDb, deleteOldClosedConversations, getSetting } = require('./lib/db');
const { processUnreadEmails } = require('./lib/emailProcessor');
const { isBusinessHoursNow } = require('./lib/wpAvailability');

const app = express();

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || '*',
  })
);
app.use(express.json());

app.use('/api/message', messageRoute);
app.use('/api/orders', ordersRoute);
app.use('/api/conversations', conversationsRoute);
app.use('/api/chat', chatRoute);
app.use('/api/email', emailRoute);
app.use('/api/settings', settingsRoute);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
const RETENTION_DAYS = parseInt(process.env.CONVERSATION_RETENTION_DAYS, 10) || 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_POLL_MS = (parseInt(process.env.EMAIL_POLL_MINUTES, 10) || 5) * 60 * 1000;

async function runCleanup() {
  try {
    const deleted = await deleteOldClosedConversations(RETENTION_DAYS);
    if (deleted > 0) {
      console.log(`Cleanup: deleted ${deleted} closed conversation(s) older than ${RETENTION_DAYS} days.`);
    }
  } catch (err) {
    console.error('Cleanup failed:', err.message);
  }
}

async function runEmailCheck() {
  if (!process.env.MS_TENANT_ID) {
    return; // Email channel not configured - skip silently.
  }

  try {
    const mode = await getSetting('email_mode', 'always');
    console.log(`Email check: mode = "${mode}"`);

    if (mode === 'off') {
      console.log('Email check: mode is off, skipping.');
      return;
    }

    if (mode === 'after_hours') {
      const businessHoursNow = await isBusinessHoursNow();
      console.log(`Email check: businessHoursNow = ${businessHoursNow}`);

      // If we genuinely can't tell (WordPress unreachable), default to
      // NOT responding - safer to leave mail for a human than guess wrong.
      if (businessHoursNow === null || businessHoursNow === true) {
        console.log('Email check: within business hours (or unknown), skipping.');
        return;
      }
    }

    console.log('Email check: proceeding to process unread emails.');
    await processUnreadEmails();
  } catch (err) {
    console.error('Email check failed:', err.message);
  }
}

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`GemAwards AI backend listening on port ${PORT}`);
    });
    // Run once shortly after startup, then on their own schedules after that.
    setTimeout(runCleanup, 60 * 1000);
    setInterval(runCleanup, ONE_DAY_MS);

    setTimeout(runEmailCheck, 30 * 1000);
    setInterval(runEmailCheck, EMAIL_POLL_MS);
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err.message);
    app.listen(PORT, () => {
      console.log(
        `GemAwards AI backend listening on port ${PORT} (database init failed - continuing without persistence)`
      );
    });
  });
