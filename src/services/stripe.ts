/**
 * Stripe service handler.
 * Intercepts: api.stripe.com
 *
 * Supported endpoints:
 *   POST /v1/payment_intents
 *   POST /v1/payment_intents/:id/confirm
 *   GET  /v1/payment_intents/:id
 *   POST /v1/checkout/sessions
 *   GET  /v1/checkout/sessions/:id
 *   POST /v1/customers
 *   GET  /v1/customers/:id
 *   POST /v1/refunds
 */

import type { ServiceHandler } from '../core/registry.js';
import { inspector } from '../core/inspector.js';
import { nanoid } from '../core/nanoid.js';
import { getScenario } from '../core/scenario.js';
import { applyDelay } from '../core/delay.js';

// ─── Stripe error builder ─────────────────────────────────────────────────────

interface StripeErrorShape {
  code: string;
  message: string;
  decline_code?: string;
  param?: string;
  type: string;
}

const CARD_ERRORS: Record<string, StripeErrorShape> = {
  card_declined: {
    code: 'card_declined',
    decline_code: 'generic_decline',
    message: 'Your card was declined.',
    type: 'card_error',
  },
  insufficient_funds: {
    code: 'card_declined',
    decline_code: 'insufficient_funds',
    message: 'Your card has insufficient funds.',
    type: 'card_error',
  },
  expired_card: {
    code: 'expired_card',
    message: 'Your card has expired.',
    type: 'card_error',
  },
  processing_error: {
    code: 'processing_error',
    message: 'An error occurred while processing your card. Try again later.',
    type: 'card_error',
  },
};

function stripeErrorResponse(scenario: string): Response {
  const err = CARD_ERRORS[scenario] ?? CARD_ERRORS['processing_error'];
  return new Response(
    JSON.stringify({ error: err }),
    {
      status: 402,
      headers: new Headers({
        'content-type': 'application/json',
        'request-id': `req_mock_${nanoid()}`,
      }),
    }
  );
}

// ─── Response builders ────────────────────────────────────────────────────────

function parseFormBody(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = decodeURIComponent(part.slice(0, eq).replace(/\+/g, ' '));
    const v = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
    out[k] = v;
  }
  return out;
}

function makeStripeHeaders(): Headers {
  return new Headers({
    'content-type': 'application/json',
    'request-id': `req_mock_${nanoid()}`,
    'stripe-version': '2024-06-20',
  });
}

function paymentIntentObject(params: Record<string, string>, scenario: string) {
  const id = `pi_mock_${nanoid(24)}`;
  const status = scenario === 'requires_action' ? 'requires_action' : 'succeeded';
  const amount = parseInt(params['amount'] ?? '1000', 10);
  const currency = params['currency'] ?? 'usd';

  return {
    id,
    object: 'payment_intent',
    amount,
    currency,
    status,
    client_secret: `${id}_secret_mock${nanoid(8)}`,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    payment_method: `pm_mock_${nanoid(16)}`,
    next_action: scenario === 'requires_action'
      ? { type: 'use_stripe_sdk', use_stripe_sdk: { type: 'three_d_secure_redirect', stripe_js: 'https://js.stripe.com/mock' } }
      : null,
    metadata: {},
  };
}

function checkoutSessionObject(params: Record<string, string>) {
  const id = `cs_mock_${nanoid(24)}`;
  return {
    id,
    object: 'checkout.session',
    status: 'complete',
    payment_status: 'paid',
    url: `https://checkout.stripe.com/mock/${id}`,
    success_url: params['success_url'] ?? 'https://example.com/success',
    cancel_url: params['cancel_url'] ?? 'https://example.com/cancel',
    customer: `cus_mock_${nanoid(14)}`,
    payment_intent: `pi_mock_${nanoid(24)}`,
    created: Math.floor(Date.now() / 1000),
    expires_at: Math.floor(Date.now() / 1000) + 1800,
    livemode: false,
    metadata: {},
  };
}

function customerObject(params: Record<string, string>) {
  return {
    id: `cus_mock_${nanoid(14)}`,
    object: 'customer',
    email: params['email'] ?? null,
    name: params['name'] ?? null,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    metadata: {},
  };
}

function refundObject(params: Record<string, string>) {
  return {
    id: `re_mock_${nanoid(24)}`,
    object: 'refund',
    amount: parseInt(params['amount'] ?? '1000', 10),
    currency: params['currency'] ?? 'usd',
    status: 'succeeded',
    payment_intent: params['payment_intent'] ?? null,
    created: Math.floor(Date.now() / 1000),
    reason: params['reason'] ?? null,
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: makeStripeHeaders(),
  });
}

// ─── Route table ─────────────────────────────────────────────────────────────

type RouteHandler = (
  path: string,
  method: string,
  params: Record<string, string>,
  scenario: string
) => Response;

const routes: Array<{ pattern: RegExp; methods: string[]; handler: RouteHandler }> = [
  // POST /v1/payment_intents
  {
    pattern: /^\/v1\/payment_intents$/,
    methods: ['POST'],
    handler: (_path, _method, params, scenario) => {
      if (scenario !== 'success' && scenario !== 'requires_action' && CARD_ERRORS[scenario]) {
        return stripeErrorResponse(scenario);
      }
      const pi = paymentIntentObject(params, scenario);
      inspector.addPayment({
        id: pi.id,
        amount: pi.amount,
        currency: pi.currency,
        status: pi.status,
        timestamp: new Date(),
      });
      return json(pi);
    },
  },
  // POST /v1/payment_intents/:id/confirm
  {
    pattern: /^\/v1\/payment_intents\/[^/]+\/confirm$/,
    methods: ['POST'],
    handler: (_path, _method, params, scenario) => {
      if (scenario !== 'success' && scenario !== 'requires_action' && CARD_ERRORS[scenario]) {
        return stripeErrorResponse(scenario);
      }
      const pi = paymentIntentObject(params, scenario);
      inspector.addPayment({
        id: pi.id,
        amount: pi.amount,
        currency: pi.currency,
        status: pi.status,
        timestamp: new Date(),
      });
      return json(pi);
    },
  },
  // GET /v1/payment_intents/:id
  {
    pattern: /^\/v1\/payment_intents\/[^/]+$/,
    methods: ['GET'],
    handler: (path) => {
      const id = path.split('/').pop()!;
      return json({ id, object: 'payment_intent', status: 'succeeded', amount: 1000, currency: 'usd' });
    },
  },
  // POST /v1/checkout/sessions
  {
    pattern: /^\/v1\/checkout\/sessions$/,
    methods: ['POST'],
    handler: (_path, _method, params) => json(checkoutSessionObject(params)),
  },
  // GET /v1/checkout/sessions/:id
  {
    pattern: /^\/v1\/checkout\/sessions\/[^/]+$/,
    methods: ['GET'],
    handler: (path) => {
      const id = path.split('/').pop()!;
      return json({ id, object: 'checkout.session', status: 'complete', payment_status: 'paid' });
    },
  },
  // POST /v1/customers
  {
    pattern: /^\/v1\/customers$/,
    methods: ['POST'],
    handler: (_path, _method, params) => json(customerObject(params), 200),
  },
  // GET /v1/customers/:id
  {
    pattern: /^\/v1\/customers\/[^/]+$/,
    methods: ['GET'],
    handler: (path) => {
      const id = path.split('/').pop()!;
      return json({ id, object: 'customer', email: null, name: null });
    },
  },
  // POST /v1/refunds
  {
    pattern: /^\/v1\/refunds$/,
    methods: ['POST'],
    handler: (_path, _method, params) => json(refundObject(params)),
  },
];

// ─── Handler ─────────────────────────────────────────────────────────────────

export const stripeHandler: ServiceHandler = {
  name: 'stripe',
  hostnames: ['api.stripe.com'],

  async handleFetch(url: string, init?: RequestInit): Promise<Response> {
    await applyDelay('stripe');

    const { pathname: path } = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const params = parseFormBody(bodyText);
    const scenario = getScenario('stripe');

    for (const route of routes) {
      if (route.pattern.test(path) && route.methods.includes(method)) {
        return route.handler(path, method, params, scenario as string);
      }
    }

    return new Response(
      JSON.stringify({ note: `devmock: unhandled Stripe path ${method} ${path}` }),
      { status: 200, headers: makeStripeHeaders() }
    );
  },
};
