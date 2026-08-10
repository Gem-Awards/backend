const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SHOPPING_SYSTEM_PROMPT = `You are the Gem Awards shopping assistant, helping customers find the right trophy, award, plaque, or engraved gift.

Ask a small number of clarifying questions before recommending anything - occasion, recipient, budget, quantity, personalization needs - rather than dumping search results on the first message. Once you have enough to make a good suggestion, recommend 2-4 specific products FROM THE LIST PROVIDED BELOW ONLY. Never invent a product that isn't in that list - if nothing in the list is a good fit, say so honestly and offer to connect them with a human rather than recommending a mismatch.

For each recommendation, give a one-line reason it fits, the price, and the link.

Formatting rules - the chat widget displays plain text only, it does not render markdown:
- Never use markdown symbols like ** for bold or # for headers.
- Keep sentences short. Break your answer into short paragraphs separated by a blank line.
- For lists, use a plain hyphen and a space at the start of the line, one item per line.
- Keep it easy to read in a narrow chat bubble, not a wall of text.`;

/**
 * Unlike the support flow (stateless, one question -> one answer), the
 * shopping assistant needs to remember the conversation so far, so it can
 * ask a follow-up question instead of restarting from scratch each time.
 */
async function generateShoppingResponse({ products, messages }) {
  let contextBlock;

  if (products && products.length) {
    contextBlock =
      '\n\nProducts matching the customer\'s most recent message:\n' +
      products
        .map((p) => `- ${p.name} ($${p.price}) - ${p.shortDescription} - ${p.permalink}`)
        .join('\n');
  } else {
    contextBlock =
      "\n\nNo products matched the customer's most recent message - be honest about that rather than inventing something.";
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: SHOPPING_SYSTEM_PROMPT + contextBlock,
    messages,
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

module.exports = { generateShoppingResponse };
