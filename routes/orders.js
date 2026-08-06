const express = require('express');
const router = express.Router();
const { findOrder } = require('../lib/woocommerce');

// POST /api/orders/lookup
// body: { orderNumber?, email? }
router.post('/lookup', async (req, res) => {
  const { orderNumber, email } = req.body;

  if (!orderNumber && !email) {
    return res
      .status(400)
      .json({ error: 'Provide an orderNumber and/or email to look up an order.' });
  }

  try {
    const order = await findOrder({ orderNumber, email });
    if (!order) {
      return res.status(404).json({
        error: 'No matching order found. Double check the order number and email.',
      });
    }
    res.json({ order });
  } catch (err) {
    console.error('Order lookup failed:', err.message);
    res.status(500).json({
      error: 'Order lookup failed. Check server logs and WooCommerce API credentials.',
    });
  }
});

module.exports = router;
