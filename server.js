require('dotenv').config();
const express = require('express');
const cors = require('cors');

const messageRoute = require('./routes/message');
const ordersRoute = require('./routes/orders');
const conversationsRoute = require('./routes/conversations');
const { initDb } = require('./lib/db');

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

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`GemAwards AI backend listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err.message);
    app.listen(PORT, () => {
      console.log(
        `GemAwards AI backend listening on port ${PORT} (database init failed - continuing without persistence)`
      );
    });
  });
