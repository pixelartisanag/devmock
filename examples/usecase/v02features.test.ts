/**
 * v02features.test.ts
 * Tests for devmock-js v0.2.0 features:
 *   - seed()        → deterministic IDs across runs
 *   - delay()       → response latency simulation
 *   - onNextCall()  → single-use scenario override
 *   - sequence()    → ordered scenario rotation
 *   - failAfter()   → succeed N times then fail
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import Stripe from 'stripe';
import OpenAI from 'openai';
import { DevMock } from '../../src/index.js';

let stripe: Stripe;
let openai: OpenAI;

beforeAll(() => {
  DevMock.enable();
  stripe = new Stripe('sk_test_fake');
  openai = new OpenAI({ apiKey: 'sk-fake' });
});

afterEach(() => {
  DevMock.inspect().clear();
  DevMock.clearScenario('stripe');
  DevMock.clearScenario('openai');
});

afterAll(() => DevMock.disable());

// ─── seed() ──────────────────────────────────────────────────────────────────

describe('seed() — deterministic IDs', () => {

  it('acelasi seed produce acelasi payment intent ID', async () => {
    DevMock.seed(42);
    const pi1 = await stripe.paymentIntents.create({ amount: 1000, currency: 'usd' });
    DevMock.inspect().clear();

    DevMock.seed(42);
    const pi2 = await stripe.paymentIntents.create({ amount: 1000, currency: 'usd' });

    expect(pi1.id).toBe(pi2.id);
    expect(pi1.id).toMatch(/^pi_mock_/);
  });

  it('seed diferit produce ID diferit', async () => {
    DevMock.seed(1);
    const pi1 = await stripe.paymentIntents.create({ amount: 1000, currency: 'usd' });
    DevMock.inspect().clear();

    DevMock.seed(2);
    const pi2 = await stripe.paymentIntents.create({ amount: 1000, currency: 'usd' });

    expect(pi1.id).not.toBe(pi2.id);
  });

  it('fara seed ID-urile sunt diferite la fiecare run', async () => {
    // disable() reseteaza seed-ul — dupa enable() suntem fara seed
    const pi1 = await stripe.paymentIntents.create({ amount: 1000, currency: 'usd' });
    DevMock.inspect().clear();
    const pi2 = await stripe.paymentIntents.create({ amount: 1000, currency: 'usd' });

    // Aproape imposibil sa fie egale fara seed
    expect(pi1.id).not.toBe(pi2.id);
  });

});

// ─── delay() ─────────────────────────────────────────────────────────────────

describe('delay() — latency simulation', () => {

  it('delay fix adauga timpul configurat', async () => {
    DevMock.delay('stripe', 100);
    const start = Date.now();
    await stripe.paymentIntents.create({ amount: 500, currency: 'usd' });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(90); // toleranta ±10ms
    DevMock.delay('stripe', 0); // curata
  });

  it('delay range genereaza valori in intervalul specificat', async () => {
    DevMock.delay('stripe', { min: 50, max: 150 });
    const start = Date.now();
    await stripe.paymentIntents.create({ amount: 500, currency: 'usd' });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(300); // buffer generos pentru CI slow
    DevMock.delay('stripe', 0);
  });

  it('delay global (*) se aplica la toate serviciile', async () => {
    DevMock.delay('*', 80);
    const start = Date.now();
    await stripe.paymentIntents.create({ amount: 500, currency: 'usd' });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(70);
    DevMock.delay('*', 0);
  });

  it('fara delay raspunsul e rapid (< 50ms)', async () => {
    const start = Date.now();
    await stripe.paymentIntents.create({ amount: 500, currency: 'usd' });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

});

// ─── onNextCall() ─────────────────────────────────────────────────────────────

describe('onNextCall() — single-use scenario', () => {

  it('primul call primeste scenariul, urmatorul revine la success', async () => {
    DevMock.onNextCall('stripe', 'card_declined');

    // Primul call — declinat
    await expect(
      stripe.paymentIntents.create({ amount: 1000, currency: 'usd' })
    ).rejects.toThrow();

    // Al doilea call — success
    const pi = await stripe.paymentIntents.create({ amount: 1000, currency: 'usd' });
    expect(pi.status).toBe('succeeded');
  });

  it('onNextCall nu afecteaza alte servicii', async () => {
    DevMock.onNextCall('stripe', 'card_declined');

    // OpenAI nu e afectat
    const res = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(res.choices[0].message.content).toBeDefined();
  });

  it('poate fi suprascris cu alt onNextCall', async () => {
    DevMock.onNextCall('stripe', 'card_declined');
    DevMock.onNextCall('stripe', 'insufficient_funds'); // suprascrie

    try {
      await stripe.paymentIntents.create({ amount: 1000, currency: 'usd' });
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/insufficient/i);
    }
  });

});

// ─── sequence() ──────────────────────────────────────────────────────────────

describe('sequence() — ordered scenario rotation', () => {

  it('consuma scenariile in ordine si repeta ultimul', async () => {
    DevMock.sequence('stripe', ['success', 'card_declined', 'insufficient_funds']);

    // Call 1 → success
    const pi1 = await stripe.paymentIntents.create({ amount: 100, currency: 'usd' });
    expect(pi1.status).toBe('succeeded');

    // Call 2 → card_declined
    await expect(stripe.paymentIntents.create({ amount: 100, currency: 'usd' })).rejects.toThrow();

    // Call 3 → insufficient_funds
    try {
      await stripe.paymentIntents.create({ amount: 100, currency: 'usd' });
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/insufficient/i);
    }

    // Call 4 → repeta ultimul (insufficient_funds)
    try {
      await stripe.paymentIntents.create({ amount: 100, currency: 'usd' });
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/insufficient/i);
    }
  });

  it('sequence cu un singur element se repeta mereu', async () => {
    DevMock.sequence('stripe', ['card_declined']);

    for (let i = 0; i < 3; i++) {
      await expect(
        stripe.paymentIntents.create({ amount: 100, currency: 'usd' })
      ).rejects.toThrow();
    }
  });

  it('clearScenario reseteaza sequence-ul', async () => {
    DevMock.sequence('stripe', ['card_declined']);
    DevMock.clearScenario('stripe');

    const pi = await stripe.paymentIntents.create({ amount: 100, currency: 'usd' });
    expect(pi.status).toBe('succeeded');
  });

});

// ─── failAfter() ─────────────────────────────────────────────────────────────

describe('failAfter() — succeed N times then fail', () => {

  it('reuseste de N ori, apoi esueaza permanent', async () => {
    DevMock.failAfter('stripe', 2, 'card_declined');

    // Call 1 → success
    const pi1 = await stripe.paymentIntents.create({ amount: 100, currency: 'usd' });
    expect(pi1.status).toBe('succeeded');

    // Call 2 → success
    const pi2 = await stripe.paymentIntents.create({ amount: 100, currency: 'usd' });
    expect(pi2.status).toBe('succeeded');

    // Call 3 → esec
    await expect(stripe.paymentIntents.create({ amount: 100, currency: 'usd' })).rejects.toThrow();

    // Call 4 → esec (permanent)
    await expect(stripe.paymentIntents.create({ amount: 100, currency: 'usd' })).rejects.toThrow();
  });

  it('failAfter(0) esueaza de la primul call', async () => {
    DevMock.failAfter('stripe', 0, 'expired_card');

    await expect(
      stripe.paymentIntents.create({ amount: 100, currency: 'usd' })
    ).rejects.toThrow();
  });

  it('util pentru testarea retry logic proprie (client fara auto-retry)', async () => {
    // Cream un client cu retries dezactivate pentru a controla retry-ul manual
    const openaiNoRetry = new OpenAI({ apiKey: 'sk-fake', maxRetries: 0 });
    DevMock.sequence('openai', ['rate_limit', 'success']);

    let attempts = 0;
    async function callWithRetry(): Promise<string> {
      try {
        attempts++;
        const res = await openaiNoRetry.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'test' }],
        });
        return res.choices[0].message.content ?? '';
      } catch {
        if (attempts < 3) return callWithRetry();
        throw new Error('Max retries exceeded');
      }
    }

    const result = await callWithRetry();
    expect(result).toContain('[devmock]');
    expect(attempts).toBe(2); // 1 esec (rate_limit) + 1 succes
  });

});
