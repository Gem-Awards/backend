const axios = require('axios');
const { getAccessToken } = require('./graphAuth');

const MAILBOX = process.env.MS_MAILBOX || 'orders@gemawards.com';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

async function graphRequest(method, path, data) {
  const token = await getAccessToken();
  const res = await axios({
    method,
    url: `${GRAPH_BASE}${path}`,
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  return res.data;
}

/**
 * Gets a simple count of unread messages in the inbox - a lightweight way
 * to confirm the connection actually works before building the full flow.
 */
async function getUnreadCount() {
  const data = await graphRequest(
    'GET',
    `/users/${MAILBOX}/mailFolders/inbox?$select=unreadItemCount`
  );
  return data.unreadItemCount;
}

/**
 * Gets unread messages from the inbox, most basic fields only.
 */
async function getUnreadMessages({ top = 10 } = {}) {
  const data = await graphRequest(
    'GET',
    `/users/${MAILBOX}/mailFolders/inbox/messages?$filter=isRead eq false&$top=${top}&$select=id,subject,from,bodyPreview,body,conversationId,receivedDateTime`
  );
  return data.value;
}

async function markAsRead(messageId) {
  await graphRequest('PATCH', `/users/${MAILBOX}/messages/${messageId}`, {
    isRead: true,
  });
}

/**
 * Replies to a specific message, correctly threaded in Outlook (appears as
 * a reply in the same conversation, not a new email).
 */
async function replyToMessage(messageId, replyText) {
  await graphRequest('POST', `/users/${MAILBOX}/messages/${messageId}/reply`, {
    comment: replyText,
  });
}

module.exports = { getUnreadCount, getUnreadMessages, markAsRead, replyToMessage };
