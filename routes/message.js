const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { searchKnowledgeBase } = require('../lib/knowledgeBase');
const { findOrder } = require('../lib/woocommerce');
const { generateResponse } = require('../lib/claude');
const {
  createConversation,
  saveMessage,
  getConversationStatus,
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
  const { message, orderNumber, email, name, conversationId: incomingId, agentAvailable } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const conversationId = incomingId || crypto.randomUUID();
  const isNewConversation = !incomingId;

  let knownEmail = email || null;
  let priorStatus = null;

  try {
    await createConversation({
      id: conversationId,
      channel: 'chat',
      customerEmail: knownEmail,
      customerName: name || null,
    });

    if (!isNewConversation) {
      priorStatus = await getConversationStatus(conversationId);
    }

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

  async function respondAndStore(replyText, escalate, conversationStatus) {
    try {
      await saveMessage({
        id: crypto.randomUUID(),
        conversationId,
        sender: 'ai',
        content: replyText,
        escalate,
        conversationStatus,
      });
    } catch (err) {
      console.error('Failed to save AI reply:', err.message);
    }
    res.json({ reply: replyText, escalate, conversationId });
  }

  // Shared escalation logic - used whether triggered by keywords on this
  // message, or by finishing an "awaiting email" exchange from a prior turn.
  async function escalate() {
    const isAvailable = agentAvailable !== false;

    if (!knownEmail) {
      return respondAndStore(
        "That sounds like something our team should help with directly. Could you share the best email to reach you at, so they can follow up with you?",
        true,
        'awaiting_email'
      );
    }

    if (isAvailable) {
      return respondAndStore(
        "That sounds like something a team member should help with directly. I'm connecting you with a human agent.",
        true,
        'escalated'
      );
    }

    try {
      await sendEscalationEmail({ conversationId, customerEmail: knownEmail, message });
    } catch (err) {
      console.error('Failed to send escalation email:', err.message);
    }

    return respondAndStore(
      `Our team is currently outside business hours, but I've forwarded your message to our support team - they'll follow up at ${knownEmail} as soon as we're back.`,
      true,
      'escalated'
    );
  }

  // If the previous turn asked this customer for their email, this message
  // is their reply to that - finish escalating regardless of what it says,
  // rather than treating it as an unrelated new question.
  if (priorStatus === 'awaiting_email') {
    if (knownEmail) {
      return escalate();
    }
    return respondAndStore(
      "I didn't quite catch an email address there - could you type it in so our team can follow up with you?",
      true,
      'awaiting_email'
    );
  }

  const lower = message.toLowerCase();
  const shouldEscalate = ESCALATION_TRIGGERS.some((t) => lower.includes(t));

  if (shouldEscalate) {
    return escalate();
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
      true,
      'escalated'
    );
  }
});

module.exports = router;
