/**
 * devmock - SDK-level service mocker for development and testing.
 *
 * Usage:
 *   import { DevMock } from 'devmock';
 *   DevMock.enable();
 *   // ... all calls to OpenAI, Anthropic, SendGrid, Twilio, Stripe are mocked
 *   DevMock.inspect().emails()          // see captured emails
 *   DevMock.scenario('stripe', 'card_declined');
 *   DevMock.inspect().clear()           // reset between tests
 *   DevMock.disable()
 */

import { enableInterceptor, disableInterceptor, isEnabled } from './core/interceptor.js';
import { registerService, type ServiceName } from './core/registry.js';
import { inspector } from './core/inspector.js';
import { setScenario, clearScenario, clearAllScenarios, type ServiceScenario } from './core/scenario.js';

import { openaiHandler } from './services/openai.js';
import { anthropicHandler } from './services/anthropic.js';
import { sendgridHandler } from './services/sendgrid.js';
import { twilioHandler } from './services/twilio.js';
import { stripeHandler } from './services/stripe.js';

// ─── Register all built-in handlers ──────────────────────────────────────────

registerService(openaiHandler);
registerService(anthropicHandler);
registerService(sendgridHandler);
registerService(twilioHandler);
registerService(stripeHandler);

// ─── Public API ───────────────────────────────────────────────────────────────

export const DevMock = {
  /**
   * Enable interception of all registered services.
   *
   * @example
   * DevMock.enable();
   */
  enable(): void {
    enableInterceptor();
    console.log('[devmock] Interceptor enabled. External service calls will be mocked.');
  },

  /** Disable interception and restore original fetch / https.request. */
  disable(): void {
    disableInterceptor();
    clearAllScenarios();
    console.log('[devmock] Interceptor disabled. Real HTTP calls restored.');
  },

  /** Returns true if the interceptor is currently active. */
  isEnabled(): boolean {
    return isEnabled();
  },

  /**
   * Set an error/edge-case scenario for a service.
   * Resets automatically when DevMock.disable() is called.
   *
   * @example
   * DevMock.scenario('stripe', 'card_declined');
   * DevMock.scenario('openai', 'rate_limit');
   * DevMock.scenario('twilio', 'invalid_number');
   */
  scenario(service: ServiceName, scenario: ServiceScenario): void {
    setScenario(service, scenario);
  },

  /**
   * Clear a specific scenario (revert service to 'success').
   */
  clearScenario(service: ServiceName): void {
    clearScenario(service);
  },

  /**
   * Access the in-memory log of all intercepted calls.
   *
   * @example
   * const log = DevMock.inspect();
   * log.emails()    // emails "sent" via SendGrid
   * log.sms()       // SMS messages "sent" via Twilio
   * log.aiCalls()   // AI completions via OpenAI / Anthropic
   * log.payments()  // payments processed via Stripe
   * log.clear()     // reset (use in afterEach / tearDown)
   */
  inspect() {
    return inspector;
  },
};

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type { EmailEntry, SmsEntry, AiCallEntry, PaymentEntry, Inspector } from './core/inspector.js';
export type { ServiceName } from './core/registry.js';
export type { ServiceScenario, StripeScenario, OpenAIScenario, TwilioScenario, AnthropicScenario } from './core/scenario.js';
