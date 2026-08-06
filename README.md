# Gem Awards AI backend (v0.1 - chat MVP)

This is the shared "AI brain" the WordPress plugin's chat widget talks to.
It answers order-status, return-policy, shipping, and pricing questions,
and hands off anything it's not confident about.

## What's in here

- `server.js` - Express app, mounts the two routes below
- `routes/message.js` - `POST /api/message` - the main chat endpoint
- `routes/orders.js` - `POST /api/orders/lookup` - WooCommerce order lookup, callable on its own for testing
- `lib/woocommerce.js` - talks to the WooCommerce REST API
- `lib/knowledgeBase.js` - **placeholder** keyword-matching KB - replace the entries with your real policy text, and eventually replace the whole file with real vector search
- `lib/claude.js` - calls the Anthropic API with retrieved context

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy the env template and fill in real values:
   ```
   cp .env.example .env
   ```
   You'll need:
   - `ANTHROPIC_API_KEY` from console.anthropic.com
   - `WC_CONSUMER_KEY` / `WC_CONSUMER_SECRET` from WooCommerce -> Settings -> Advanced -> REST API on your **staging** site (give the key Read permissions only for now)
   - `WC_BASE_URL` - your staging site's `/wp-json/wc/v3`
3. Run it locally:
   ```
   npm run dev
   ```
   You should see `GemAwards AI backend listening on port 3000`.

## Test it before touching WordPress at all

```
# Health check
curl http://localhost:3000/health

# Order lookup (use a real order number + email from your staging store)
curl -X POST http://localhost:3000/api/orders/lookup \
  -H "Content-Type: application/json" \
  -d '{"orderNumber": "123", "email": "test@example.com"}'

# Chat message (policy question, no order needed)
curl -X POST http://localhost:3000/api/message \
  -H "Content-Type: application/json" \
  -d '{"message": "what is your return policy?"}'

# Chat message that should escalate
curl -X POST http://localhost:3000/api/message \
  -H "Content-Type: application/json" \
  -d '{"message": "my item arrived damaged, I want a refund"}'
```

If all four work, the backend is solid and you're ready to deploy it and
connect the WordPress plugin.

## Deploying

Push this folder to a Render or Railway service (Node.js). Set the same
environment variables from `.env` in their dashboard - **never commit your
real `.env` file**. Once deployed, you'll get a public URL
(e.g. `https://gemawards-ai.onrender.com`) - that's what goes into the
WordPress plugin's settings page.

## Known placeholders to swap out later

- `lib/knowledgeBase.js` - real content + real vector search
- `ESCALATION_TRIGGERS` in `routes/message.js` - a real classifier
- `extractTracking()` in `lib/woocommerce.js` - confirm the actual meta key your tracking plugin uses
