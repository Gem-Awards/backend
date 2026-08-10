const axios = require('axios');

const WC_BASE_URL = process.env.WC_BASE_URL;
const WC_KEY = process.env.WC_CONSUMER_KEY;
const WC_SECRET = process.env.WC_CONSUMER_SECRET;

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').trim();
}

/**
 * Searches your live WooCommerce catalog - no separate product database to
 * keep in sync, results are always current. Fine at your current catalog
 * size; if the catalog grows very large, a proper indexed/vector search
 * would scale better than a live API call per question.
 */
async function searchProducts(query, { perPage = 6 } = {}) {
  if (!WC_BASE_URL || !WC_KEY || !WC_SECRET) {
    throw new Error(
      'WooCommerce API credentials are not configured. Set WC_BASE_URL, WC_CONSUMER_KEY, WC_CONSUMER_SECRET in .env'
    );
  }

  const res = await axios.get(`${WC_BASE_URL}/products`, {
    auth: { username: WC_KEY, password: WC_SECRET },
    params: {
      search: query,
      per_page: perPage,
      status: 'publish',
    },
  });

  return res.data.map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    permalink: p.permalink,
    shortDescription: stripHtml(p.short_description),
    categories: (p.categories || []).map((c) => c.name),
  }));
}

module.exports = { searchProducts };
