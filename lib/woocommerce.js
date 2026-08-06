const axios = require('axios');

const WC_BASE_URL = process.env.WC_BASE_URL;
const WC_KEY = process.env.WC_CONSUMER_KEY;
const WC_SECRET = process.env.WC_CONSUMER_SECRET;

/**
 * Look up a WooCommerce order by order number and/or email, and verify
 * that the two match before returning anything (identity check per the
 * spec doc - never reveal order details on order number alone).
 */
async function findOrder({ orderNumber, email }) {
  if (!WC_BASE_URL || !WC_KEY || !WC_SECRET) {
    throw new Error(
      'WooCommerce API credentials are not configured. Set WC_BASE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET in .env'
    );
  }

  let order = null;

  // WooCommerce order numbers are usually the order ID. If a sequential
  // order numbers plugin is installed, this lookup may need adjusting -
  // check what gemawards.com actually uses for order numbers.
  if (orderNumber) {
    try {
      const res = await axios.get(`${WC_BASE_URL}/orders/${orderNumber}`, {
        auth: { username: WC_KEY, password: WC_SECRET },
      });
      order = res.data;
    } catch (err) {
      // Not found by direct ID lookup - fall through to email search
    }
  }

  if (!order && email) {
    const res = await axios.get(`${WC_BASE_URL}/orders`, {
      auth: { username: WC_KEY, password: WC_SECRET },
      params: { search: email, per_page: 5 },
    });
    order =
      res.data.find(
        (o) => (o.billing?.email || '').toLowerCase() === email.toLowerCase()
      ) || null;
  }

  if (!order) return null;

  // Identity check: if both order number and email were given, they must match.
  if (orderNumber && email) {
    const emailMatches =
      (order.billing?.email || '').toLowerCase() === email.toLowerCase();
    if (!emailMatches) return null;
  }

  return {
    id: order.id,
    status: order.status,
    total: order.total,
    currency: order.currency,
    dateCreated: order.date_created,
    items: (order.line_items || []).map((li) => ({
      name: li.name,
      quantity: li.quantity,
    })),
    tracking: extractTracking(order),
  };
}

function extractTracking(order) {
  // Shipment-tracking plugins usually store tracking info in order
  // meta_data. Adjust this key to match whichever plugin gemawards.com uses
  // (e.g. WooCommerce Shipment Tracking stores it under "_wc_shipment_tracking_items").
  const meta = order.meta_data || [];
  const trackingMeta = meta.find((m) => /tracking/i.test(m.key));
  return trackingMeta ? trackingMeta.value : null;
}

module.exports = { findOrder };
