const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { searchKnowledgeBase } = require('../lib/knowledgeBase');
const { findOrder } = require('../lib/woocommerce');
const { generateResponse } = require('../lib/claude');
const { searchProducts } = require('../lib/products');
const { generateShoppingResponse } = require('../lib/shoppingAssistant');
const {
  createConversation,
  saveMessage,
  getConversation,
  getConversationStatus,
  getConversationIntent,
  setConversationIntent,
  getConversationContact,
  updateConversationContact,
} = require('../lib/db');
const { sendEscalationEmail } = require('../lib/email');

// Rough escalation triggers to start with. Replace with a real
// intent/sentiment classifier once you have real conversation logs to tune
// against (see "Escalation Rules" in the spec doc).
const ESCALATION_TRIGGERS = [
  'refund',
  'angry',
  'human',
  'agent',
  'representative',
  'complaint',
];

const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/;

// Rough shopping-intent triggers to start with, same "replace with a real
// classifier later" caveat as ESCALATION_TRIGGERS above.
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
  'employee of the month',
  'recognition',
  'help me find',
  'shopping for',
];

// Pulls an email and, heuristically, a name out of a reply to "what's your
// name and email?" - not meant to scan arbitrary messages, only used right
// after we've explicitly asked for this info.
function parseContactInfo(text) {
  const emailMatch = text.match(EMAIL_REGEX);
  const email = emailMatch ? emailMatch[0] : null;

  let namePart = email ? text.replace(email, '') : text;
  namePart = namePart
    .replace(/\b(it'?s|i'?m|im|my name is|this is|and my email is|and email is|email is|name is)\b/gi, '')
    .replace(/[,.:;!\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const name = namePart && namePart.length <= 60 ? namePart : null;

  return { email, name };
}

// POST /api/message
// body: { message, orderNumber?, email?, name?, conversationId?, agentAvailable? }
router.post('/', async (req, res) => {
  const { message, orderNumber, email, name, conversationId: incomingId, agentAvailable } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const conversationId = incomingId || crypto.randomUUID();
  const isNewConversation = !incomingId;

  let knownEmail = email || null;
  let knownName = name || null;
  let priorStatus = null;

  try {
    await createConversation({
      id: conversationId,
      channel: 'chat',
      customerEmail: knownEmail,
      customerName: knownName,
    });

    if (!isNewConversation) {
      priorStatus = await getConversationStatus(conversationId);
      const contact = await getConversationContact(conversationId);
      if (!knownEmail) knownEmail = contact.email;
      if (!knownName) knownName = contact.name;
    }

    const typedEmailMatch = message.match(EMAIL_REGEX);
    if (typedEmailMatch && typedEmailMatch[0] !== knownEmail) {
      knownEmail = typedEmailMatch[0];
      await updateConversationContact(conversationId, { email: knownEmail });
    }

    await saveMessage({
      id: crypto.randomUUID(),
      conversationId,
      sender: 'customer',
      content: message,
      escalate: false,
      conversationStatus: priorStatus || undefined,
    });
  } catch (err) {
    // Don't let a storage failure block the chat itself - degrade gracefully.
    console.error('Failed to save customer message:', err.message);
  }

  async function respondAndStore(replyText, escalate, conversationStatus, extra) {
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
    res.json({ reply: replyText, escalate, conversationId, ...(extra || {}) });
  }

  // Shared escalation logic - used whether triggered by keywords on this
  // message, by finishing an "awaiting contact info" exchange, or by the
  // shopping assistant handing off. An optional leadIn is prepended, so
  // callers can keep their own explanation text rather than losing it to
  // a generic message.
  async function escalate(leadIn) {
    const prefix = `${leadIn || 'That sounds like something our team should help with directly.'}\n\n`;
    const isAvailable = agentAvailable !== false;

    if (!knownEmail) {
      const prompt = knownName
        ? 'Could you share the best email to reach you at, so they can follow up with you?'
        : 'Could you share your name and the best email to reach you at, so they can follow up with you?';
      return respondAndStore(prefix + prompt, true, 'awaiting_email');
    }

    if (isAvailable) {
      return respondAndStore(
        prefix + "I'm connecting you with a human agent now.",
        true,
        'escalated'
      );
    }

    try {
      await sendEscalationEmail({
        conversationId,
        customerEmail: knownEmail,
        customerName: knownName,
        message,
      });
    } catch (err) {
      console.error('Failed to send escalation email:', err.message);
    }

    return respondAndStore(
      prefix +
        `Our team is currently outside business hours, but I've forwarded your message to our support team - they'll follow up at ${knownEmail} as soon as we're back.`,
      true,
      'escalated'
    );
  }

  // Searches live product data and asks Claude to respond conversationally,
  // with the full conversation so far as memory (unlike support, which
  // answers each message independently).
  async function handleShoppingAssistant() {
    try {
      await setConversationIntent(conversationId, 'shopping');
    } catch (err) {
      console.error('Failed to set shopping intent:', err.message);
    }

    let claudeMessages = [{ role: 'user', content: message }];
    let searchQuery = message;

    try {
      const conv = await getConversation(conversationId);
      if (conv && conv.messages && conv.messages.length) {
        claudeMessages = conv.messages
          .filter((m) => m.sender === 'customer' || m.sender === 'ai' || m.sender === 'agent')
          .map((m) => ({
            role: m.sender === 'customer' ? 'user' : 'assistant',
            content: m.content,
          }));

        // Search using everything the customer has said so far, not just
        // the latest reply - the product-type keyword ("award", "trophy")
        // is often only mentioned once, early on, not repeated every turn.
        const customerText = conv.messages
          .filter((m) => m.sender === 'customer')
          .map((m) => m.content)
          .join(' ');
        if (customerText) {
          searchQuery = customerText;
        }
      }
    } catch (err) {
      console.error('Failed to load conversation history:', err.message);
    }

    let products = [];
    try {
      products = await searchProducts(searchQuery);
      if (!products.length) {
        // Fallback so a noisy/detail-heavy query doesn't come back totally
        // empty - gives the AI something reasonable to work with.
        products = await searchProducts('award trophy plaque');
      }
    } catch (err) {
      console.error('Product search failed:', err.message);
    }

    if (!products.length) {
      // No usable product data at all, for any reason (search error, or
      // genuinely nothing matched). Don't let the AI improvise contact
      // details or invent products - hand off to the real escalation flow,
      // which knows your actual business hours and how to actually reach
      // a human, instead of guessing.
      return escalate();
    }

    try {
      const reply = await generateShoppingResponse({ products, messages: claudeMessages });

      const NEEDS_HUMAN_MARKER = /\n?\s*NEEDS_HUMAN\s*$/i;
      if (NEEDS_HUMAN_MARKER.test(reply)) {
        const explanation = reply.replace(NEEDS_HUMAN_MARKER, '').trim();
        return escalate(explanation);
      }

      // Pull out exactly which products the AI says it recommended, rather
      // than guessing from its prose - keeps the visual cards grounded in
      // what it actually said, not a separate parse of free text.
      const RECOMMENDED_IDS_MARKER = /\n?\s*RECOMMENDED_IDS:\s*(.*)\s*$/im;
      let cleanReply = reply;
      let recommendedProducts = [];

      const idsMatch = reply.match(RECOMMENDED_IDS_MARKER);
      if (idsMatch) {
        cleanReply = reply.replace(RECOMMENDED_IDS_MARKER, '').trim();
        const idsRaw = idsMatch[1].trim();
        if (idsRaw && idsRaw.toLowerCase() !== 'none') {
          const ids = idsRaw
            .split(',')
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !Number.isNaN(n));
          recommendedProducts = products
            .filter((p) => ids.includes(p.id))
            .map((p) => ({
              id: p.id,
              name: p.name,
              price: p.price,
              permalink: p.permalink,
              image: p.image,
            }));
        }
      }

      // Safety net: if the AI leaks "[ID: n]" into the visible text (instead
      // of, or in addition to, the trailing marker), strip it so the
      // customer never sees it, and use it as a fallback source of IDs if
      // the trailing marker was missing entirely.
      const INLINE_ID_MARKER = /\[ID:\s*(\d+)\]/gi;
      const inlineIds = [];
      let inlineMatch;
      while ((inlineMatch = INLINE_ID_MARKER.exec(cleanReply)) !== null) {
        inlineIds.push(parseInt(inlineMatch[1], 10));
      }
      cleanReply = cleanReply.replace(/\s*\[ID:\s*\d+\]/gi, '').trim();

      if (!recommendedProducts.length && inlineIds.length) {
        recommendedProducts = products
          .filter((p) => inlineIds.includes(p.id))
          .map((p) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            permalink: p.permalink,
            image: p.image,
          }));
      }

      return respondAndStore(cleanReply, false, 'ai_active', { products: recommendedProducts });
    } catch (err) {
      console.error('Shopping assistant failed:', err.message);
      return respondAndStore(
        "Sorry, I'm having trouble pulling up product suggestions right now. Let me connect you with a human agent.",
        true,
        'escalated'
      );
    }
  }

  // If the previous turn asked this customer for their name/email, this
  // message is their reply to that - parse what we can out of it and
  // finish escalating, rather than treating it as an unrelated question.
  if (priorStatus === 'awaiting_email') {
    const parsed = parseContactInfo(message);
    if (parsed.email) knownEmail = parsed.email;
    if (parsed.name && !knownName) knownName = parsed.name;

    if (knownEmail || knownName) {
      try {
        await updateConversationContact(conversationId, { email: knownEmail, name: knownName });
      } catch (err) {
        console.error('Failed to save contact info:', err.message);
      }
    }

    if (knownEmail) {
      return escalate();
    }
    return respondAndStore(
      "I didn't quite catch an email address there - could you type it in so our team can follow up with you?",
      true,
      'awaiting_email'
    );
  }

  // A human is already handling this conversation (either the "connecting
  // you now" live handoff, or an agent has already replied) - just save
  // this message for them rather than routing it back through the AI. The
  // customer message was already saved above, so there's nothing more to
  // do here except tell the widget not to show an AI bubble.
  if (priorStatus === 'escalated') {
    return res.json({ reply: null, escalate: true, conversationId });
  }

  const lower = message.toLowerCase();
  const shouldEscalate = ESCALATION_TRIGGERS.some((t) => lower.includes(t));

  if (shouldEscalate) {
    return escalate();
  }

  let intent = null;
  try {
    intent = await getConversationIntent(conversationId);
  } catch (err) {
    console.error('Failed to load conversation intent:', err.message);
  }

  const isShoppingIntent =
    intent === 'shopping' || SHOPPING_TRIGGERS.some((t) => lower.includes(t));

  if (isShoppingIntent) {
    return handleShoppingAssistant();
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

    const FOLLOWUP_MARKER = /\n?\s*NEEDS_HUMAN_FOLLOWUP\s*$/i;
    if (FOLLOWUP_MARKER.test(reply)) {
      const cleanReply = reply.replace(FOLLOWUP_MARKER, '').trim();
      // Still send the AI's answer - it may be genuinely useful - but flag
      // the conversation as needing a human to follow up, same status used
      // elsewhere for anything that needs attention in Live Chats.
      return respondAndStore(cleanReply, true, 'escalated');
    }

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
