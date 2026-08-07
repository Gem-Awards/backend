const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { searchKnowledgeBase } = require('../lib/knowledgeBase');
const { findOrder } = require('../lib/woocommerce');
const { generateResponse } = require('../lib/claude');
const { createConversation, saveMessage } = require('../lib/db');
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

// POST /api/message
// body: { message, orderNumber?, email?, conversationId? }
router.post('/', async (req, res) => {
  const { message, orderNumber, email, conversationId: incomingId, agentAvailable } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  // Reuse the conversation ID the widget sends back after the first message,
  // or start a new one if this is the first message of the session.
  const conversationId = incomingId || crypto.randomUUID();

  try {
    await createConversation({ id: conversationId, channel: 'chat', customerEmail: email });
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

    if (isAvailable) {
      return respondAndStore(
        "That sounds like something a team member should help with directly. I'm connecting you with a human agent.",
        true
      );
    }

    try {
      await sendEscalationEmail({ conversationId, customerEmail: email, message });
    } catch (err) {
      console.error('Failed to send escalation email:', err.message);
    }

    return respondAndStore(
      "Our team is currently outside business hours, but I've forwarded your message to our support team - they'll follow up as soon as we're back.",
      true
    );
  }

  try {
    const kbContext = searchKnowledgeBase(message);

    let orderContext = null;
    if (orderNumber || email) {
      orderContext = await findOrder({ orderNumber, email });
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
