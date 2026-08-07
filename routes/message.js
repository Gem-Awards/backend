const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { searchKnowledgeBase } = require('../lib/knowledgeBase');
const { findOrder } = require('../lib/woocommerce');
const { generateResponse } = require('../lib/claude');
const { createConversation, saveMessage } = require('../lib/db');

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
  const { message, orderNumber, email, conversationId: incomingId } = req.body;

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
    return respondAndStore(
      "That sounds like something a team member should help with directly. I'm connecting you with a human agent.",
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
