const axios = require('axios');

/**
 * Asks WordPress whether an agent is currently available (same business
 * hours logic already configured for chat) - reused here so there's only
 * ever one place to manage your actual hours, not a separate copy.
 */
async function isBusinessHoursNow() {
  const siteUrl = process.env.WP_SITE_URL;
  if (!siteUrl) {
    console.warn('WP_SITE_URL is not set - "after hours only" email mode cannot check business hours.');
    return null;
  }

  try {
    const res = await axios.get(
      `${siteUrl.replace(/\/$/, '')}/wp-json/gai-helpdesk/v1/availability`,
      { timeout: 8000 }
    );
    return !!res.data.available;
  } catch (err) {
    console.error('Failed to check WordPress availability:', err.message);
    return null; // Unknown - caller decides how to handle this safely.
  }
}

module.exports = { isBusinessHoursNow };
