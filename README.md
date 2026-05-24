# devmock

SDK-level service mocker for Node.js. Intercepts calls to **OpenAI, Anthropic, Stripe, SendGrid, and Twilio** at the HTTP transport layer — no config changes, no real API keys, no cost.

```bash
npm install --save-dev devmock
```

---

## Why devmock?

| | Without devmock | With devmock |
|---|---|---|
| API credentials needed | Yes (per service) | None |
| Cost per CI run | $0.01 – $0.10 | **$0** |
| Test execution time | 3 – 10 seconds | **< 200ms** |
| Works offline | No | **Yes** |
| Assert on email/SMS content | No | **Yes** |
| Simulate card declines / rate limits | No | **Yes** |

---

## Quick Start

```typescript
import { DevMock } from 'devmock';
import OpenAI from 'openai';

// 1. Enable before instantiating SDKs
DevMock.enable();

// 2. Use your SDKs exactly as in production
const openai = new OpenAI({ apiKey: 'sk-...' }); // key doesn't matter
const completion = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }],
});

// 3. Inspect what was "sent"
const calls = DevMock.inspect().aiCalls();
console.log(calls[0].response); // "[devmock] Mock response to: "Hello!""

DevMock.disable();
```

Or use the side-effect import for zero-setup:

```typescript
import 'devmock/register'; // enables automatically
```

---

## Test Setup (Vitest / Jest)

```typescript
import { DevMock } from 'devmock';
import { beforeAll, afterEach, afterAll } from 'vitest';

beforeAll(() => {
  DevMock.enable();
  // Instantiate SDKs that use fetch (Anthropic) AFTER enable()
  // SDKs that use https.request (OpenAI, Stripe, Twilio) can be instantiated anytime
});

afterEach(() => DevMock.inspect().clear());
afterAll(() => DevMock.disable());
```

Or via config file (no code changes needed):

```typescript
// vitest.config.ts
export default { test: { setupFiles: ['devmock/register'] } }
```

---

## Supported Services

### OpenAI

```typescript
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: 'fake' });

// Chat completions (non-streaming)
const res = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
});
// res.choices[0].message.content → "[devmock] Mock response to: "Hello""
// res.usage.total_tokens         → realistic token count

// Streaming
const stream = await openai.chat.completions.create({
  model: 'gpt-4', stream: true,
  messages: [{ role: 'user', content: 'Hello' }],
});
for await (const chunk of stream) { /* works exactly like real streaming */ }

// Embeddings
const emb = await openai.embeddings.create({ model: 'text-embedding-ada-002', input: 'hello' });
// emb.data[0].embedding → 1536-dimensional vector
```

### Anthropic

> **Note:** Anthropic SDK captures `fetch` at instantiation time.
> Create the client **after** `DevMock.enable()`.

```typescript
import Anthropic from '@anthropic-ai/sdk';

DevMock.enable(); // must be before new Anthropic()
const anthropic = new Anthropic({ apiKey: 'fake' });

const msg = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  max_tokens: 100,
  messages: [{ role: 'user', content: 'Hello' }],
});
// msg.content[0].text → "[devmock] Mock response to: "Hello""
```

### Stripe

```typescript
import Stripe from 'stripe';
const stripe = new Stripe('sk_test_fake');

// Payment Intents
const pi = await stripe.paymentIntents.create({ amount: 2000, currency: 'usd' });
// pi.id     → "pi_mock_..."
// pi.status → "succeeded"

// Checkout Sessions
const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  line_items: [{ price: 'price_xxx', quantity: 1 }],
  success_url: 'https://example.com/success',
  cancel_url: 'https://example.com/cancel',
});
// session.id  → "cs_mock_..."
// session.url → "https://checkout.stripe.com/mock/cs_mock_..."

// Inspect payments
const payments = DevMock.inspect().payments();
// [{ id: "pi_mock_...", amount: 2000, currency: "usd", status: "succeeded" }]
```

### SendGrid

```typescript
import sgMail from '@sendgrid/mail';
sgMail.setApiKey('SG.fake');

await sgMail.send({
  to: 'user@example.com',
  from: 'noreply@myapp.com',
  subject: 'Welcome!',
  text: 'Hello there',
  html: '<h1>Hello there</h1>',
});
// Returns 202 Accepted (exactly like the real API)

const emails = DevMock.inspect().emails();
// [{ to: "user@example.com", from: "noreply@myapp.com",
//    subject: "Welcome!", body: "Hello there", html: "...",
//    messageId: "devmock-msg-...", timestamp: Date }]
```

### Twilio

```typescript
import twilio from 'twilio';
const client = twilio('ACfake', 'fake_token');

const msg = await client.messages.create({
  to: '+40712345678',
  from: '+15005550006',
  body: 'Your code is 123456',
});
// msg.sid    → "SMmock..."
// msg.status → "queued"

const smsList = DevMock.inspect().sms();
// [{ to: "+40712345678", from: "+15005550006",
//    body: "Your code is 123456", sid: "SMmock...", timestamp: Date }]
```

---

## Scenarios — Simulating Errors & Edge Cases

```typescript
// Stripe card errors
DevMock.scenario('stripe', 'card_declined');
DevMock.scenario('stripe', 'insufficient_funds');
DevMock.scenario('stripe', 'expired_card');
DevMock.scenario('stripe', 'processing_error');
DevMock.scenario('stripe', 'requires_action'); // 3DS flow

// OpenAI errors
DevMock.scenario('openai', 'rate_limit');
DevMock.scenario('openai', 'context_length_exceeded');
DevMock.scenario('openai', 'server_error');

// Anthropic errors
DevMock.scenario('anthropic', 'rate_limit');
DevMock.scenario('anthropic', 'overloaded');

// Twilio errors
DevMock.scenario('twilio', 'invalid_number');

// Reset a specific scenario
DevMock.clearScenario('stripe');
// Scenarios are also cleared automatically on DevMock.disable()
```

### Testing error handling:

```typescript
it('handles card declined gracefully', async () => {
  DevMock.scenario('stripe', 'card_declined');

  await expect(
    processPayment({ amount: 1000, currency: 'usd' })
  ).rejects.toThrow(/card.*declined/i);

  // Verify no email was sent on failed payment
  expect(DevMock.inspect().emails()).toHaveLength(0);
});
```

---

## Inspector API

```typescript
const log = DevMock.inspect();

log.emails()    // EmailEntry[]  — captured SendGrid emails
log.sms()       // SmsEntry[]    — captured Twilio SMS messages
log.aiCalls()   // AiCallEntry[] — OpenAI + Anthropic calls
log.payments()  // PaymentEntry[] — Stripe payment intents

log.clear()     // reset all (use in afterEach)
```

### Types

```typescript
interface EmailEntry {
  to: string | string[];
  from: string;
  subject: string;
  body: string;
  html?: string;
  messageId: string;
  timestamp: Date;
}

interface SmsEntry {
  to: string;
  from: string;
  body: string;
  sid: string;
  timestamp: Date;
}

interface AiCallEntry {
  service: 'openai' | 'anthropic';
  model: string;
  messages: Array<{ role: string; content: string }>;
  response: string;
  promptTokens: number;
  completionTokens: number;
  timestamp: Date;
}

interface PaymentEntry {
  id: string;
  amount: number;
  currency: string;
  status: string;
  timestamp: Date;
}
```

---

## How It Works

devmock patches two HTTP primitives in Node.js:

1. **`globalThis.fetch`** — used by modern SDKs (Anthropic v0.98+)
2. **`https.request`** — used by `node-fetch` v2, axios, got, and older SDKs (OpenAI v4, Stripe, Twilio)

When a call to a known service hostname is detected (e.g. `api.openai.com`), it is routed to the appropriate mock handler instead of making a real network request. All other HTTP calls pass through untouched.

```
Your Code → SDK → fetch / https.request → [devmock router]
                                                 ↓
                                         known service?
                                        yes ↓       no ↓
                                      mock handler   real network
                                           ↓
                                     realistic response
                                     + inspector log
```

---

## SDK Instantiation Order

| SDK | Transport | Instantiation |
|---|---|---|
| OpenAI v4 | `node-fetch` → `https.request` | Any time |
| Stripe | axios → `https.request` | Any time |
| Twilio | axios → `https.request` | Any time |
| SendGrid | axios → `https.request` | Any time |
| **Anthropic v0.98+** | **`globalThis.fetch`** | **After `DevMock.enable()`** |

---

## Requirements

- Node.js ≥ 18
- Works with ESM and CommonJS projects

---

## License

MIT
