const axios = require('axios');

const TENANT_ID = process.env.MS_TENANT_ID;
const CLIENT_ID = process.env.MS_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET;

let cachedToken = null;
let cachedTokenExpiresAt = 0;

/**
 * Gets an access token for calling Microsoft Graph, using the "client
 * credentials" flow - this authenticates as the app itself (no signed-in
 * person involved), which is what a backend service needs. Tokens are
 * cached in memory and only refreshed once they're close to expiring.
 */
async function getAccessToken() {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      'Microsoft Graph credentials are not configured. Set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET in .env'
    );
  }

  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await axios.post(url, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  cachedToken = res.data.access_token;
  // Refresh a couple minutes before actual expiry, to be safe.
  cachedTokenExpiresAt = now + (res.data.expires_in - 120) * 1000;

  return cachedToken;
}

module.exports = { getAccessToken };
