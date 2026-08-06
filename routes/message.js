const express = require('express');
const router = express.Router();
const { searchKnowledgeBase } = require('../lib/knowledgeBase');
const { findOrder } = require('../lib/woocommerce');
const { generateResponse } = require('../lib/claude');

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
// body: { message, orderNumber?, email? }
router.post('/', async (req, res) => {
  const { message, orderNumber, email } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const lower = message.toLowerCase();
  const shouldEscalate = ESCALATION_TRIGGERS.some((t) => lower.includes(t));

  if (shouldEscalate) {
    return res.json({
      reply:
        "That sounds like something a team member should help with directly. I'm connecting you with a human agent.",
      escalate: true,
    });
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

    res.json({ reply, escalate: false });
  } catch (err) {
    console.error('AI reasoning failed:', err.message);
    res.status(500).json({
      reply:
        "Sorry, I'm having trouble answering right now. Let me connect you with a human agent.",
      escalate: true,
    });
  }
});

module.exports = router;
