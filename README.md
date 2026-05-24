# devmock-js

[![npm version](https://img.shields.io/npm/v/devmock-js.svg?style=flat-square)](https://www.npmjs.com/package/devmock-js)
[![npm downloads](https://img.shields.io/npm/dm/devmock-js.svg?style=flat-square)](https://www.npmjs.com/package/devmock-js)
[![license](https://img.shields.io/npm/l/devmock-js.svg?style=flat-square)](https://github.com/pixelartisanag/devmock/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/devmock-js.svg?style=flat-square)](https://www.npmjs.com/package/devmock-js)
[![GitHub stars](https://img.shields.io/github/stars/pixelartisanag/devmock?style=flat-square)](https://github.com/pixelartisanag/devmock/stargazers)

SDK-level HTTP interceptor for Node.js. Mocks **OpenAI, Anthropic, Stripe, SendGrid, and Twilio** transparently — no config changes, no real API keys, no cost.

```bash
npm install --save-dev devmock-js
```

---

## Table of Contents

- [Why devmock-js?](#why-devmock-js)
- [Quick Start](#quick-start)
- [Test Setup](#test-setup-vitest--jest)
- [Supported Services](#supported-services)
  - [OpenAI](#openai)
  - [Anthropic](#anthropic)
  - [Stripe](#stripe)
  - [SendGrid](#sendgrid)
  - [Twilio](#twilio)
- [Scenarios — Simulating Errors](#scenarios--simulating-errors--edge-cases)
- [Inspector API](#inspector-api)
- [How It Works](#how-it-works)
- [SDK Instantiation Order](#sdk-instantiation-order)
- [Contributing](#contributing)
- [License](#license)

---

## Why devmock-js?

Every time you run tests against real external services, you pay in **time**, **money**, and **reliability**. A single CI pipeline that calls OpenAI, Stripe, and SendGrid can cost $0.05–$0.20 per run and take 10+ seconds — or simply fail because an API is down.

devmock-js intercepts at the **HTTP transport layer**, so your SDKs behave exactly as in production without leaving your machine.

| | Without devmock-js | With devmock-js |
|---|---|---|
| API credentials in CI | Required (per service) | **None** |
| Cost per CI run | $0.01 – $0.20 | **$0** |
| Test execution time | 5 – 15 seconds | **< 200ms** |
| Works offline | No | **Yes** |
| Assert on email / SMS content | No | **Yes** |
| Simulate card declines / rate limits | No | **Yes** |
| Flaky due to external APIs | Yes | **No** |

---

## Quick Start

```typescript
import { DevMock } from 'devmock-js';
import OpenAI from 'openai';

// 1. Enable before instantiating SDKs
DevMock.enable();

// 2. Use your SDKs exactly as in production — API keys are irrelevant
const openai = new OpenAI({ apiKey: 'sk-fake' });

const completion = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }],
});
// completion.choices[0].message.content → "[devmock] Mock response to: "Hello!""
// completion.usage.total_tokens         → realistic token count
// No real HTTP request was made.

// 3. Inspect what was "called"
const calls = DevMock.inspect().aiCalls();
console.log(calls.length); // 1

// 4. Disable when done
DevMock.disable();
```

Or use the side-effect import for zero-code setup:

```typescript
import 'devmock-js/register'; // enables automatically on import
```

---

## Test Setup (Vitest / Jest)

### Option A — explicit setup in test file

```typescript
import { DevMock } from 'devmock-js';
import { beforeAll, afterEach, afterAll } from 'vitest';

beforeAll(() => {
  DevMock.enable();
  // SDKs that capture fetch at instantiation time (e.g. Anthropic)
  // must be created AFTER enable(). See SDK Instantiation Order below.
});

afterEach(() => DevMock.inspect().clear()); // reset between tests
afterAll(() => DevMock.disable());
```

### Option B — global setup file (no code changes in test files)

```typescript
// vitest.config.ts
export default {
  test: {
    setupFiles: ['devmock-js/register'],
  },
};
```

```javascript
// jest.config.js
module.exports = {
  setupFiles: ['devmock-js/register'],
};
```

---

## Supported Services

### OpenAI

Intercepts `api.openai.com`. Works with the official [`openai`](https://www.npmjs.com/package/openai) npm package.

```typescript
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: 'sk-fake' });

// Chat completions — non-streaming
const res = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Summarize this.' }],
});
console.log(res.choices[0].message.content);
// "[devmock] Mock response to: "Summarize this.""
console.log(res.usage?.total_tokens); // realistic count based on input length

// Chat completions — streaming
const stream = await openai.chat.completions.create({
  model: 'gpt-4o',
  stream: true,
  messages: [{ role: 'user', content: 'Hello' }],
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
// Streams word-by-word with 10ms delay between chunks, exactly like the real API.

// Embeddings
const emb = await openai.embeddings.create({
  model: 'text-embedding-ada-002',
  input: 'Hello world',
});
console.log(emb.data[0].embedding.length); // 1536
```

---

### Anthropic

Intercepts `api.anthropic.com`. Works with the official [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk) npm package.

> **Important:** The Anthropic SDK captures `fetch` at instantiation time.
> Always create the Anthropic client **after** calling `DevMock.enable()`.

```typescript
import Anthropic from '@anthropic-ai/sdk';

DevMock.enable(); // ← must come before new Anthropic()

const anthropic = new Anthropic({ apiKey: 'sk-ant-fake' });

// Non-streaming
const msg = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  max_tokens: 200,
  messages: [{ role: 'user', content: 'What is TypeScript?' }],
});
console.log(msg.content[0].type);  // "text"
console.log((msg.content[0] as { type: 'text'; text: string }).text);
// "[devmock] Mock response to: "What is TypeScript?""
console.log(msg.stop_reason); // "end_turn"
```

---

### Stripe

Intercepts `api.stripe.com`. Works with the official [`stripe`](https://www.npmjs.com/package/stripe) npm package.

```typescript
import Stripe from 'stripe';
const stripe = new Stripe('sk_test_fake');

// Payment Intents
const pi = await stripe.paymentIntents.create({
  amount: 4999,
  currency: 'ron',
});
console.log(pi.id);            // "pi_mock_..."
console.log(pi.status);        // "succeeded"
console.log(pi.client_secret); // "pi_mock_..._secret_mock..."

// Checkout Sessions
const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  line_items: [{ price: 'price_xxx', quantity: 1 }],
  success_url: 'https://myapp.com/success',
  cancel_url:  'https://myapp.com/cancel',
});
console.log(session.id);             // "cs_mock_..."
console.log(session.payment_status); // "paid"
console.log(session.url);            // "https://checkout.stripe.com/mock/cs_mock_..."

// Customers
const customer = await stripe.customers.create({ email: 'user@example.com' });
console.log(customer.id); // "cus_mock_..."

// Refunds
const refund = await stripe.refunds.create({ payment_intent: pi.id });
console.log(refund.status); // "succeeded"

// Inspect captured payments
const payments = DevMock.inspect().payments();
// [{ id: "pi_mock_...", amount: 4999, currency: "ron", status: "succeeded", timestamp: Date }]
```

---

### SendGrid

Intercepts `api.sendgrid.com`. Works with the official [`@sendgrid/mail`](https://www.npmjs.com/package/@sendgrid/mail) npm package and direct `fetch` calls.

```typescript
import sgMail from '@sendgrid/mail';
sgMail.setApiKey('SG.fake');

await sgMail.send({
  to: 'user@example.com',
  from: { email: 'noreply@myapp.com', name: 'MyApp' },
  subject: 'Welcome to MyApp!',
  text: 'Thanks for signing up.',
  html: '<h1>Thanks for signing up.</h1>',
});
// HTTP response: 202 Accepted — identical to the real SendGrid API

// Inspect captured emails
const emails = DevMock.inspect().emails();
console.log(emails[0].to);        // "user@example.com"
console.log(emails[0].subject);   // "Welcome to MyApp!"
console.log(emails[0].body);      // "Thanks for signing up."
console.log(emails[0].html);      // "<h1>Thanks for signing up.</h1>"
console.log(emails[0].messageId); // "devmock-msg-..."
```

---

### Twilio

Intercepts `api.twilio.com`. Works with the official [`twilio`](https://www.npmjs.com/package/twilio) npm package.

```typescript
import twilio from 'twilio';
const client = twilio('ACfake', 'fake_token');

const msg = await client.messages.create({
  to:   '+40712345678',
  from: '+15005550006',
  body: 'Your verification code is 847291',
});
console.log(msg.sid);    // "SMmock..."
console.log(msg.status); // "queued"

// Inspect captured SMS messages
const smsList = DevMock.inspect().sms();
console.log(smsList[0].to);   // "+40712345678"
console.log(smsList[0].body); // "Your verification code is 847291"
console.log(smsList[0].sid);  // "SMmock..."
```

---

## Scenarios — Simulating Errors & Edge Cases

Use scenarios to test how your application handles failures — without needing to trigger real API errors.

```typescript
// ── Stripe ───────────────────────────────────────────────────────────
DevMock.scenario('stripe', 'card_declined');      // generic decline
DevMock.scenario('stripe', 'insufficient_funds'); // 402 insufficient_funds
DevMock.scenario('stripe', 'expired_card');       // 402 expired_card
DevMock.scenario('stripe', 'processing_error');   // 402 processing_error
DevMock.scenario('stripe', 'requires_action');    // 3DS — status: requires_action

// ── OpenAI ───────────────────────────────────────────────────────────
DevMock.scenario('openai', 'rate_limit');               // 429
DevMock.scenario('openai', 'context_length_exceeded');  // 400
DevMock.scenario('openai', 'server_error');             // 500

// ── Anthropic ────────────────────────────────────────────────────────
DevMock.scenario('anthropic', 'rate_limit');  // 429
DevMock.scenario('anthropic', 'overloaded');  // 529

// ── Twilio ───────────────────────────────────────────────────────────
DevMock.scenario('twilio', 'invalid_number'); // 400

// Reset a specific service to success
DevMock.clearScenario('stripe');

// All scenarios are cleared automatically on DevMock.disable()
```

### Example — testing payment failure handling

```typescript
it('shows an error message when card is declined', async () => {
  DevMock.scenario('stripe', 'card_declined');

  const result = await checkout({ amount: 2000, currency: 'usd' });

  expect(result.success).toBe(false);
  expect(result.error).toMatch(/card.*declined/i);

  // Confirm no confirmation email was sent
  expect(DevMock.inspect().emails()).toHaveLength(0);
});

it('retries on Anthropic overload', async () => {
  let calls = 0;
  DevMock.scenario('anthropic', 'overloaded');

  // Your service should retry — after 1 failed attempt, succeed
  setTimeout(() => DevMock.clearScenario('anthropic'), 50);

  const result = await generateWithRetry('Write a summary');
  expect(result).toBeDefined();
});
```

---

## Inspector API

```typescript
const log = DevMock.inspect();

log.emails()    // EmailEntry[]   — emails captured from SendGrid calls
log.sms()       // SmsEntry[]     — SMS messages captured from Twilio calls
log.aiCalls()   // AiCallEntry[]  — completions from OpenAI and Anthropic
log.payments()  // PaymentEntry[] — payment intents and sessions from Stripe

log.clear()     // reset all logs — call in afterEach()
```

### Type Reference

```typescript
interface EmailEntry {
  to: string | string[];  // recipient(s)
  from: string;           // sender address
  subject: string;
  body: string;           // text/plain content
  html?: string;          // text/html content
  messageId: string;      // "devmock-msg-..."
  timestamp: Date;
}

interface SmsEntry {
  to: string;    // E.164 format e.g. "+40712345678"
  from: string;
  body: string;
  sid: string;   // "SMmock..."
  timestamp: Date;
}

interface AiCallEntry {
  service: 'openai' | 'anthropic';
  model: string;
  messages: Array<{ role: string; content: string }>;
  response: string;           // the mock response text
  promptTokens: number;
  completionTokens: number;
  timestamp: Date;
}

interface PaymentEntry {
  id: string;       // "pi_mock_..."
  amount: number;   // in smallest currency unit (cents)
  currency: string; // ISO 4217 e.g. "usd"
  status: string;   // "succeeded" | "requires_action" | ...
  timestamp: Date;
}
```

---

## How It Works

devmock-js patches two HTTP primitives in Node.js at runtime:

1. **`globalThis.fetch`** — used by modern SDKs (Anthropic v0.98+, future SDKs)
2. **`https.request`** — used by `node-fetch` v2, `axios`, `got`, and legacy SDKs (OpenAI v4, Stripe, Twilio, SendGrid)

When a request URL matches a known service hostname (e.g. `api.openai.com`), it is routed to the appropriate mock handler. All other requests pass through to the real network untouched.

```
Your App Code
     │
     ▼
 SDK (openai / stripe / twilio / ...)
     │
     ▼
 fetch()  /  https.request()         ← devmock-js patches here
     │
     ▼
 ┌──────────────────────────────┐
 │       devmock router         │
 │  hostname → service handler  │
 └──────────┬───────────────────┘
            │
     known? │
    ┌───────┴────────┐
    ▼                ▼
 mock handler    real network
    │
    ▼
 realistic response
 + inspector log
```

Both patches are reversible: `DevMock.disable()` restores the original `fetch` and `https.request` exactly as they were.

---

## SDK Instantiation Order

Most SDKs resolve HTTP transport at **call time** and work regardless of when the client is instantiated. One exception:

| SDK | Transport used | Instantiate |
|---|---|---|
| `openai` v4 | `node-fetch` → `https.request` | Any time |
| `stripe` | `axios` → `https.request` | Any time |
| `twilio` | `axios` → `https.request` | Any time |
| `@sendgrid/mail` | `axios` → `https.request` | Any time |
| **`@anthropic-ai/sdk` v0.98+** | **`globalThis.fetch`** captured at `new Anthropic()` | **After `DevMock.enable()`** |

```typescript
// Correct
DevMock.enable();
const anthropic = new Anthropic({ apiKey: '...' }); // ✓ after enable

// Incorrect — fetch captured before patch
const anthropic = new Anthropic({ apiKey: '...' }); // ✗ before enable
DevMock.enable();
```

---

## Contributing

Contributions are welcome. Please read the guidelines before opening a pull request.

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes with tests
4. Ensure all tests pass: `npm test`
5. Open a pull request — squash merge will be used

### Adding a new service handler

1. Create `src/services/yourservice.ts` implementing `ServiceHandler`
2. Register it in `src/index.ts` with `registerService(yourServiceHandler)`
3. Add scenario types to `src/core/scenario.ts`
4. Write tests in `examples/usecase/`

```typescript
// src/services/yourservice.ts
import type { ServiceHandler } from '../core/registry.js';

export const yourServiceHandler: ServiceHandler = {
  name: 'yourservice',
  hostnames: ['api.yourservice.com'],

  async handleFetch(url: string, init?: RequestInit): Promise<Response> {
    // parse request, return mock Response
    return new Response(JSON.stringify({ mock: true }), {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
    });
  },
};
```

### Development scripts

```bash
npm run build        # compile ESM + CJS + .d.ts
npm run build:watch  # watch mode
npm test             # run all tests
npm run test:watch   # watch mode
npm run demo         # run the end-to-end demo
```

---

## License

[MIT](./LICENSE) © [pixelartisanag](https://github.com/pixelartisanag)
