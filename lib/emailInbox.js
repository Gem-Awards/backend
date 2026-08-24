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
 * A deliberately minimal request - no $select, no $filter, nothing that
 * counts as an OData query option. Used to isolate whether the "Access to
 * OData is disabled" error is about mailbox access in general, or
 * specifically about query-parameter usage.
 */
async function getInboxFolderRaw() {
  return graphRequest('GET', `/users/${MAILBOX}/mailFolders/inbox`);
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
    `/users/${MAILBOX}/mailFolders/inbox/messages?$filter=isRead eq false&$top=${top}&$select=id,subject,from,bodyPreview,body,conversationId,receivedDateTime,categories`
  );
  return data.value;
}

async function markAsRead(messageId) {
  await graphRequest('PATCH', `/users/${MAILBOX}/messages/${messageId}`, {
    isRead: true,
  });
}

/**
 * Tags a message with a visible Outlook category, so it's distinguishable
 * from a plain "never looked at" unread email - shows as a colored label
 * in Outlook's normal inbox view. Also used defensively so a message we've
 * already processed is never mistaken for new mail, even if someone
 * manually marks it unread again later.
 */
async function tagCategory(messageId, category) {
  await graphRequest('PATCH', `/users/${MAILBOX}/messages/${messageId}`, {
    categories: [category],
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

/**
 * Creates a draft reply instead of sending it - the AI's answer sits in
 * your Drafts folder, correctly threaded, untouched until a real person
 * reviews it (and edits if needed) and hits Send themselves.
 */
async function createDraftReply(messageId, replyText) {
  const draft = await graphRequest(
    'POST',
    `/users/${MAILBOX}/messages/${messageId}/createReply`,
    {}
  );

  await graphRequest('PATCH', `/users/${MAILBOX}/messages/${draft.id}`, {
    body: { contentType: 'text', content: replyText },
  });

  return draft;
}

module.exports = {
  getUnreadCount,
  getUnreadMessages,
  markAsRead,
  tagCategory,
  replyToMessage,
  createDraftReply,
  getInboxFolderRaw,
};
