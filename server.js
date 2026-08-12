require('dotenv').config();
const express = require('express');
const cors = require('cors');

const messageRoute = require('./routes/message');
const ordersRoute = require('./routes/orders');
const conversationsRoute = require('./routes/conversations');
const chatRoute = require('./routes/chat');
const emailRoute = require('./routes/email');
const { initDb, deleteOldClosedConversations } = require('./lib/db');

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

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
const RETENTION_DAYS = parseInt(process.env.CONVERSATION_RETENTION_DAYS, 10) || 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`GemAwards AI backend listening on port ${PORT}`);
    });
    // Run once shortly after startup, then once a day after that.
    setTimeout(runCleanup, 60 * 1000);
    setInterval(runCleanup, ONE_DAY_MS);
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err.message);
    app.listen(PORT, () => {
      console.log(
        `GemAwards AI backend listening on port ${PORT} (database init failed - continuing without persistence)`
      );
    });
  });
