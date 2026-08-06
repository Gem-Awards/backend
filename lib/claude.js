const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are the Gem Awards customer support assistant. Answer customer questions about orders, returns, shipping, and pricing using ONLY the context provided below. If the context doesn't contain the answer, or the question involves something you're not confident about (refunds, damaged items, custom requests, complaints), say so plainly and recommend connecting the customer with a human agent. Keep answers short, warm, and specific.`;

async function generateResponse({ userMessage, kbContext, orderContext }) {
  let contextBlock = '';

  if (kbContext && kbContext.length) {
    contextBlock +=
      '\n\nRelevant policy info:\n' +
      kbContext.map((k) => `- ${k.title}: ${k.content}`).join('\n');
  }

  if (orderContext) {
    contextBlock += `\n\nCustomer's order:\n${JSON.stringify(orderContext, null, 2)}`;
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: SYSTEM_PROMPT + contextBlock,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

module.exports = { generateResponse };
