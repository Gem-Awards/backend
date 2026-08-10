const axios = require('axios');

const WC_BASE_URL = process.env.WC_BASE_URL;
const WC_KEY = process.env.WC_CONSUMER_KEY;
const WC_SECRET = process.env.WC_CONSUMER_SECRET;

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').trim();
}

function mapProduct(p) {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    permalink: p.permalink,
    shortDescription: stripHtml(p.short_description),
    categories: (p.categories || []).map((c) => c.name),
  };
}

// Generic words that shouldn't be used to match category names - too broad,
// likely to cause noisy/false category matches without adding real signal.
const KEYWORD_STOPWORDS = new Set([
  'general',
  'budget',
  'style',
  'classic',
  'medium',
  'photo',
  'text',
  'message',
  'congratulatory',
  'need',
  'just',
  'want',
  'looking',
  'would',
  'like',
  'please',
  'thanks',
  'thank',
]);

function extractKeywords(query) {
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3 && !KEYWORD_STOPWORDS.has(w));
}

let categoriesCache = null;
let categoriesCacheTime = 0;
const CATEGORY_CACHE_MS = 60 * 60 * 1000; // 1 hour - categories don't change often

async function getCategories() {
  const now = Date.now();
  if (categoriesCache && now - categoriesCacheTime < CATEGORY_CACHE_MS) {
    return categoriesCache;
  }

  const res = await axios.get(`${WC_BASE_URL}/products/categories`, {
    auth: { username: WC_KEY, password: WC_SECRET },
    params: { per_page: 100 },
  });

  categoriesCache = res.data.map((c) => ({ id: c.id, name: c.name, slug: c.slug }));
  categoriesCacheTime = now;
  return categoriesCache;
}

/**
 * Searches by matching keywords against category names, then fetching
 * products within those categories - uses WooCommerce's category taxonomy
 * filter (reliable) rather than its free-text search (known to be
 * unreliable), and covers far more of the catalog than scanning a small
 * recent slice of products. Uses WooCommerce's max per_page (100) rather
 * than a small cap, since capping low with no relevance ordering meant
 * results depended on arbitrary luck of which 30 happened to come back
 * first when many categories matched.
 */
async function searchByCategory(query) {
  const keywords = extractKeywords(query);
  if (!keywords.length) return [];

  const categories = await getCategories();
  const matchingIds = categories
    .filter((c) => keywords.some((kw) => c.name.toLowerCase().includes(kw)))
    .map((c) => c.id);

  if (!matchingIds.length) return [];

  const res = await axios.get(`${WC_BASE_URL}/products`, {
    auth: { username: WC_KEY, password: WC_SECRET },
    params: {
      category: matchingIds.join(','),
      per_page: 100,
      status: 'publish',
    },
  });

  return res.data.map(mapProduct);
}

/**
 * WooCommerce's REST API `search` parameter has known reliability issues on
 * some sites (reported upstream, reproduced even with no other plugins
 * active) - as a fallback, pull a broader batch of published products and
 * match keywords ourselves, so results don't depend on that parameter
 * working correctly.
 */
async function fallbackKeywordSearch(query) {
  const res = await axios.get(`${WC_BASE_URL}/products`, {
    auth: { username: WC_KEY, password: WC_SECRET },
    params: { per_page: 100, status: 'publish' },
  });

  const keywords = extractKeywords(query);
  if (!keywords.length) return [];

  const matches = res.data.filter((p) => {
    const haystack = (
      p.name +
      ' ' +
      stripHtml(p.short_description) +
      ' ' +
      (p.categories || []).map((c) => c.name).join(' ')
    ).toLowerCase();
    return keywords.some((kw) => haystack.includes(kw));
  });

  return matches.slice(0, 6).map(mapProduct);
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

  let products = res.data.map(mapProduct);

  if (!products.length) {
    products = await searchByCategory(query);
  }

  if (!products.length) {
    products = await fallbackKeywordSearch(query);
  }

  return products.slice(0, 20);
}

module.exports = { searchProducts };
