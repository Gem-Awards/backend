const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { searchKnowledgeBase } = require('../lib/knowledgeBase');
const { findOrder } = require('../lib/woocommerce');
const { generateResponse } = require('../lib/claude');
const {
  createConversation,
  saveMessage,
  getConversationEmail,
  updateConversationEmail,
} = require('../lib/db');
const { sendEscalationEmail } = require('../lib/email');

// Rough escalation triggers to start with. Replace with a real
// intent/sentiment classifier once you have real conversation logs to tune
// against (see "Escalation Rules" in the spec doc).
const ESCALATION_TRIGGERS = [
  'refund',
  'damaged',
  'broken',
  'angry',
  'human',
  'agent',
  'representative',
  'complaint',
];

const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/;

// POST /api/message
// body: { message, orderNumber?, email?, conversationId?, agentAvailable? }
router.post('/', async (req, res) => {
  const { message, orderNumber, email, conversationId: incomingId, agentAvailable } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  // Reuse the conversation ID the widget sends back after the first message,
  // or start a new one if this is the first message of the session.
  const conversationId = incomingId || crypto.randomUUID();

  // Figure out the best email we know for this customer: what the widget
  // sent (e.g. a logged-in account email), one already saved on this
  // conversation from an earlier message, or one the customer just typed.
  let knownEmail = email || null;

  try {
    await createConversation({ id: conversationId, channel: 'chat', customerEmail: knownEmail });

    if (!knownEmail) {
      knownEmail = await getConversationEmail(conversationId);
    }

    const typedEmailMatch = message.match(EMAIL_REGEX);
    if (typedEmailMatch && typedEmailMatch[0] !== knownEmail) {
      knownEmail = typedEmailMatch[0];
      await updateConversationEmail(conversationId, knownEmail);
    }

    await saveMessage({
      id: crypto.randomUUID(),
      conversationId,
      sender: 'customer',
      content: message,
      escalate: false,
    });
  } catch (err) {
    // Don't let a storage failure block the chat itself - degrade gracefully.
    console.error('Failed to save customer message:', err.message);
  }

  async function respondAndStore(replyText, escalate) {
    try {
      await saveMessage({
        id: crypto.randomUUID(),
        conversationId,
        sender: 'ai',
        content: replyText,
        escalate,
      });
    } catch (err) {
      console.error('Failed to save AI reply:', err.message);
    }
    res.json({ reply: replyText, escalate, conversationId });
  }

  const lower = message.toLowerCase();
  const shouldEscalate = ESCALATION_TRIGGERS.some((t) => lower.includes(t));

  if (shouldEscalate) {
    // agentAvailable defaults to true (treat as during-hours) if the widget
    // didn't send it, so older/unconfigured widgets keep working as before.
    const isAvailable = agentAvailable !== false;

    // Don't hand off (live or by email) without a way to reach the customer
    // back - ask for their email first instead of escalating blind.
    if (!knownEmail) {
      return respondAndStore(
        "That sounds like something our team should help with directly. Could you share the best email to reach you at, so they can follow up with you?",
        true
      );
    }

    if (isAvailable) {
      return respondAndStore(
        "That sounds like something a team member should help with directly. I'm connecting you with a human agent.",
        true
      );
    }

    try {
      await sendEscalationEmail({ conversationId, customerEmail: knownEmail, message });
    } catch (err) {
      console.error('Failed to send escalation email:', err.message);
    }

    return respondAndStore(
      `Our team is currently outside business hours, but I've forwarded your message to our support team - they'll follow up at ${knownEmail} as soon as we're back.`,
      true
    );
  }

  try {
    const kbContext = searchKnowledgeBase(message);

    let orderContext = null;
    if (orderNumber || knownEmail) {
      orderContext = await findOrder({ orderNumber, email: knownEmail });
    }

    const reply = await generateResponse({
      userMessage: message,
      kbContext,
      orderContext,
    });

    return respondAndStore(reply, false);
  } catch (err) {
    console.error('AI reasoning failed:', err.message);
    return respondAndStore(
      "Sorry, I'm having trouble answering right now. Let me connect you with a human agent.",
      true
    );
  }
});

module.exports = router;
