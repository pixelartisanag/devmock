/**
 * paymentService.test.ts
 *
 * Teste pentru Stripe + Anthropic + sistemul de scenarii.
 * Demonstreaza cum testezi flows de plata fara cont Stripe real.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import Stripe from 'stripe';
import Anthropic from '@anthropic-ai/sdk';
import { DevMock } from '../../src/index.js';

// ─── Setup ────────────────────────────────────────────────────────────────────

// IMPORTANT: SDK-urile care captureaza `fetch` la instantiere (ex: Anthropic)
// trebuie instantiate DUPA DevMock.enable(), nu la nivel de modul.
// SDK-urile care folosesc https.request (ex: Stripe, OpenAI v4) pot fi
// instantiate oricand - sunt interceptate la nivel de transport.

let stripe: Stripe;
let anthropic: Anthropic;

beforeAll(() => {
  DevMock.enable();
  // Instantiem dupa enable() - fetch-ul capturat de Anthropic SDK va fi cel patched
  stripe = new Stripe('sk_test_devmock_fake_key_not_real', { apiVersion: '2024-06-20' });
  anthropic = new Anthropic({ apiKey: 'sk-ant-devmock-fake' });
});

afterEach(() => {
  DevMock.inspect().clear();
  DevMock.clearScenario('stripe');
  DevMock.clearScenario('anthropic');
});
afterAll(() => DevMock.disable());

// ─── Stripe: happy path ───────────────────────────────────────────────────────

describe('Stripe - Payment Intents', () => {

  it('creeaza un payment intent cu succes', async () => {
    const pi = await stripe.paymentIntents.create({
      amount: 4999,
      currency: 'ron',
    });

    expect(pi.id).toMatch(/^pi_mock_/);
    expect(pi.status).toBe('succeeded');
    expect(pi.amount).toBe(4999);
    expect(pi.currency).toBe('ron');
  });

  it('inregistreaza plata in inspector', async () => {
    await stripe.paymentIntents.create({ amount: 2000, currency: 'usd' });

    const payments = DevMock.inspect().payments();
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(2000);
    expect(payments[0].status).toBe('succeeded');
  });

  it('client_secret are formatul corect', async () => {
    const pi = await stripe.paymentIntents.create({ amount: 1000, currency: 'eur' });
    expect(pi.client_secret).toContain('_secret_');
  });

});

// ─── Stripe: scenarii de eroare ────────────────────────────────────────────────

describe('Stripe - Scenarii de eroare', () => {

  it('scenario card_declined → arunca StripeCardError', async () => {
    DevMock.scenario('stripe', 'card_declined');

    await expect(
      stripe.paymentIntents.create({ amount: 1000, currency: 'usd' })
    ).rejects.toThrow();
  });

  it('scenario insufficient_funds → eroare cu mesaj corect', async () => {
    DevMock.scenario('stripe', 'insufficient_funds');

    try {
      await stripe.paymentIntents.create({ amount: 9999999, currency: 'usd' });
      expect.fail('Trebuia sa arunce eroare');
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/insufficient_funds|insufficient funds/i);
    }
  });

  it('scenario expired_card', async () => {
    DevMock.scenario('stripe', 'expired_card');

    try {
      await stripe.paymentIntents.create({ amount: 1000, currency: 'usd' });
      expect.fail('Trebuia sa arunce eroare');
    } catch (err: unknown) {
      expect((err as Error).message).toMatch(/expired/i);
    }
  });

  it('dupa clearScenario() revine la succes', async () => {
    DevMock.scenario('stripe', 'card_declined');
    DevMock.clearScenario('stripe');

    const pi = await stripe.paymentIntents.create({ amount: 500, currency: 'usd' });
    expect(pi.status).toBe('succeeded');
  });

});

// ─── Stripe: Checkout Sessions ────────────────────────────────────────────────

describe('Stripe - Checkout Sessions', () => {

  it('creeaza o sesiune de checkout', async () => {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: 'price_mock', quantity: 1 }],
      success_url: 'https://myapp.com/success',
      cancel_url: 'https://myapp.com/cancel',
    });

    expect(session.id).toMatch(/^cs_mock_/);
    expect(session.status).toBe('complete');
    expect(session.payment_status).toBe('paid');
  });

});

// ─── Anthropic ─────────────────────────────────────────────────────────────────

describe('Anthropic - Messages API', () => {

  it('returneaza raspuns valid non-streaming', async () => {
    const msg = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Salut Claude!' }],
    });

    expect(msg.id).toMatch(/^msg_mock_/);
    expect(msg.role).toBe('assistant');
    expect(msg.content[0].type).toBe('text');
    expect((msg.content[0] as { type: string; text: string }).text).toContain('[devmock]');
    expect(msg.stop_reason).toBe('end_turn');
  });

  it('inregistreaza apelul AI in inspector', async () => {
    await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Test inspector' }],
    });

    const calls = DevMock.inspect().aiCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].service).toBe('anthropic');
    expect(calls[0].model).toBe('claude-opus-4-5');
  });

  it('scenario rate_limit → arunca eroare', async () => {
    DevMock.scenario('anthropic', 'rate_limit');

    await expect(
      anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Test' }],
      })
    ).rejects.toThrow();
  });

  it('scenario overloaded → arunca eroare', async () => {
    DevMock.scenario('anthropic', 'overloaded');

    await expect(
      anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Test' }],
      })
    ).rejects.toThrow();
  });

});

// ─── Test combinat: checkout + AI + email ─────────────────────────────────────

describe('Flow combinat: plata reusita → email de confirmare AI-generat', () => {

  it('flow complet: plata → AI → email', async () => {
    // 1. Proceseaza plata
    const pi = await stripe.paymentIntents.create({
      amount: 9900,
      currency: 'ron',
      metadata: { product: 'Plan Pro' },
    });
    expect(pi.status).toBe('succeeded');

    // 2. Genereaza email de confirmare cu AI
    const aiMsg = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `Scrie un email de confirmare pentru plata de ${pi.amount / 100} RON pentru Plan Pro.`,
      }],
    });
    const emailBody = (aiMsg.content[0] as { type: string; text: string }).text;

    // 3. Trimite emailul (fetch direct la SendGrid)
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer SG.fake' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: 'client@example.com' }] }],
        from: { email: 'billing@myapp.com' },
        subject: 'Confirmare plata Plan Pro',
        content: [{ type: 'text/plain', value: emailBody }],
      }),
    });

    // ─── Assert pe tot flow-ul ─────────────────────────────────────────────
    const payments = DevMock.inspect().payments();
    const aiCalls  = DevMock.inspect().aiCalls();
    const emails   = DevMock.inspect().emails();

    expect(payments).toHaveLength(1);
    expect(aiCalls).toHaveLength(1);
    expect(emails).toHaveLength(1);

    // Emailul contine raspunsul AI
    expect(emails[0].body).toBe(emailBody);
    expect(emails[0].to).toBe('client@example.com');

    // Plata a mers cu suma corecta
    expect(payments[0].amount).toBe(9900);
  });

});
