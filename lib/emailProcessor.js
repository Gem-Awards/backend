const crypto = require('crypto');
const { searchKnowledgeBase } = require('./knowledgeBase');
const { findOrder } = require('./woocommerce');
const { generateResponse } = require('./claude');
const { getUnreadMessages, markAsRead, tagCategory, replyToMessage } = require('./emailInbox');
const {
  createConversation,
  saveMessage,
  getConversationStatus,
  updateConversationStatus,
  hasProcessedSourceMessage,
} = require('./db');

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
  // The reliable guard: check OUR OWN database, not Outlook's read-state or
  // tags. Those can fail to update for reasons outside our control (a
  // dropped request, a race between two backend instances, etc.) - this
  // check is what actually prevents a duplicate reply, regardless of what
  // happened on Microsoft's side last time.
  const alreadyProcessed = await hasProcessedSourceMessage(message.id).catch(() => false);
  if (alreadyProcessed) {
    return;
  }

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

  // Fast, reliable check for obviously-automated senders (other tools'
  // daily digests, system notifications, etc.) - catches these without
  // even needing to call the AI, cheaper and more reliable than relying on
  // its judgment for something this mechanically detectable.
  if (senderEmail && /no.?reply/i.test(senderEmail)) {
    await markAsRead(message.id).catch(() => {});
    return;
  }

  const rawBody = message.body?.content || message.bodyPreview || '';
  const bodyText = stripHtml(rawBody).slice(0, 4000);

  // Use Graph's own conversationId (which groups a reply thread) as our
  // internal conversation id too, so an email thread and a Live Chats
  // conversation are the same thing under the hood.
  const conversationId = `email-${message.conversationId}`;

  const priorStatus = await getConversationStatus(conversationId).catch(() => null);

  let saveSucceeded = true;
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
      sourceMessageId: message.id,
    });
  } catch (err) {
    console.error('Failed to save inbound email:', err.message);
    saveSucceeded = false;
  }

  if (!saveSucceeded) {
    // This save is what our duplicate-reply guard depends on - if it
    // didn't go through, stop here rather than risk replying without any
    // record of having done so. The next polling cycle will retry from
    // scratch, which is safer than an unprotected reply.
    return;
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

    if (rawReply.trim() === 'NOT_CUSTOMER_MESSAGE') {
      // Spam, vendor solicitation, or otherwise not a real customer inquiry
      // - don't reply at all. Mark it read so we don't keep re-analyzing
      // the same message every polling cycle. Close out the conversation
      // entry too (created earlier, before we knew this was spam) so it
      // doesn't linger as "needs attention" - it'll be cleared out by the
      // normal auto-cleanup job like any other closed conversation.
      await markAsRead(message.id).catch(() => {});
      await updateConversationStatus(conversationId, 'closed').catch(() => {});
      return;
    }

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

    if (needsFollowup) {
      // Deliberately NOT marking this as read - your team already watches
      // unread count in Outlook every day, so leaving it unread is the
      // signal that this one still needs a person, even though the
      // customer already got a reply. The category tag makes it visually
      // distinct from a plain "nobody's looked at this yet" unread email,
      // and also protects it from being reprocessed if marked unread again.
      await tagCategory(message.id, 'AI: Needs Follow-up').catch(() => {});
    } else {
      await markAsRead(message.id);
      // Tag it too, so manually marking it unread later doesn't cause a
      // duplicate reply to go out.
      await tagCategory(message.id, 'AI: Answered').catch(() => {});
    }

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
