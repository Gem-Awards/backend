const crypto = require('crypto');
const { searchKnowledgeBase } = require('./knowledgeBase');
const { findOrder } = require('./woocommerce');
const { generateResponse } = require('./claude');
const { getUnreadMessages, markAsRead, replyToMessage } = require('./emailInbox');
const { createConversation, saveMessage, getConversationStatus } = require('./db');

// Same idea as chat's ESCALATION_TRIGGERS, but email has no live agent to
// connect to - anything matching these just gets left unread for a human,
// nothing gets auto-replied.
const ESCALATION_TRIGGERS = [
  'refund',
  'angry',
  'complaint',
  'cancel my order',
];

// Shopping requests also get left for a human on the email channel for now
// - the shopping assistant's clarifying-question flow and product cards
// don't translate well to a single email exchange.
const SHOPPING_TRIGGERS = [
  'looking for',
  'gift for',
  'gift idea',
  'award for',
  'need something for',
  'present for',
  'trophy for',
  'plaque for',
  'recommend',
  'help me find',
  'shopping for',
];

function stripHtml(html) {
  return (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks the inbox for new mail and processes each one. Meant to be run on
 * a schedule (see server.js).
 */
async function processUnreadEmails() {
  let messages;
  try {
    messages = await getUnreadMessages({ top: 10 });
  } catch (err) {
    console.error('Failed to fetch unread emails:', err.response?.data || err.message);
    return;
  }

  for (const message of messages) {
    try {
      await processOneEmail(message);
    } catch (err) {
      console.error(`Failed to process email ${message.id}:`, err.message);
    }
  }
}

async function processOneEmail(message) {
  const senderEmail = message.from?.emailAddress?.address || null;
  const senderName = message.from?.emailAddress?.name || null;

  // Emails sent FROM the mailbox TO itself are automated notifications
  // (e.g. a website contact form forwarding a submission), not a real
  // customer writing in directly - the actual customer's info is just text
  // inside the body, not the real sender. Leave these completely untouched
  // for a human to see normally, same as before this feature existed.
  const mailboxAddress = (process.env.MS_MAILBOX || 'orders@gemawards.com').toLowerCase();
  if (senderEmail && senderEmail.toLowerCase() === mailboxAddress) {
    return;
  }

  const rawBody = message.body?.content || message.bodyPreview || '';
  const bodyText = stripHtml(rawBody).slice(0, 4000);

  // Use Graph's own conversationId (which groups a reply thread) as our
  // internal conversation id too, so an email thread and a Live Chats
  // conversation are the same thing under the hood.
  const conversationId = `email-${message.conversationId}`;

  const priorStatus = await getConversationStatus(conversationId).catch(() => null);

  try {
    await createConversation({
      id: conversationId,
      channel: 'email',
      customerEmail: senderEmail,
      customerName: senderName,
    });
    await saveMessage({
      id: crypto.randomUUID(),
      conversationId,
      sender: 'customer',
      content: bodyText,
      escalate: false,
      conversationStatus: priorStatus || undefined,
    });
  } catch (err) {
    console.error('Failed to save inbound email:', err.message);
  }

  const lower = bodyText.toLowerCase();
  const needsHuman =
    ESCALATION_TRIGGERS.some((t) => lower.includes(t)) ||
    SHOPPING_TRIGGERS.some((t) => lower.includes(t));

  if (needsHuman) {
    // Leave it unread and don't reply - it stays exactly as visible to your
    // team as any other email, just also logged here for cross-channel
    // visibility in Live Chats.
    try {
      await saveMessage({
        id: crypto.randomUUID(),
        conversationId,
        sender: 'ai',
        content: '[Left for a team member - not auto-replied]',
        escalate: true,
        conversationStatus: 'escalated',
      });
    } catch (err) {
      console.error('Failed to log escalation:', err.message);
    }
    return;
  }

  let replyText;
  let needsFollowup = false;
  try {
    const kbContext = searchKnowledgeBase(bodyText);
    let orderContext = null;
    if (senderEmail) {
      orderContext = await findOrder({ email: senderEmail }).catch(() => null);
    }
    const rawReply = await generateResponse({ userMessage: bodyText, kbContext, orderContext });

    const FOLLOWUP_MARKER = /\n?\s*NEEDS_HUMAN_FOLLOWUP\s*$/i;
    if (FOLLOWUP_MARKER.test(rawReply)) {
      needsFollowup = true;
      replyText = rawReply.replace(FOLLOWUP_MARKER, '').trim();
    } else {
      replyText = rawReply;
    }
  } catch (err) {
    console.error('AI reasoning failed for email:', err.message);
    // Same principle as above - if we're not confident, leave it alone
    // rather than send something that might be wrong.
    return;
  }

  try {
    await replyToMessage(message.id, replyText);
    await markAsRead(message.id);
    await saveMessage({
      id: crypto.randomUUID(),
      conversationId,
      sender: 'ai',
      content: replyText,
      escalate: needsFollowup,
      conversationStatus: needsFollowup ? 'escalated' : 'ai_active',
    });
  } catch (err) {
    console.error(
      'Failed to send/save email reply:',
      JSON.stringify(err.response?.data || err.message)
    );
  }
}

module.exports = { processUnreadEmails };
