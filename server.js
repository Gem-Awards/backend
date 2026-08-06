require('dotenv').config();
const express = require('express');
const cors = require('cors');

const messageRoute = require('./routes/message');
const ordersRoute = require('./routes/orders');

const app = express();

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || '*',
  })
);
app.use(express.json());

app.use('/api/message', messageRoute);
app.use('/api/orders', ordersRoute);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`GemAwards AI backend listening on port ${PORT}`);
});
