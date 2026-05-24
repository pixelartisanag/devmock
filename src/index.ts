/**
 * devmock-js — SDK-level service mocker for development and testing.
 *
 * @example
 * import { DevMock } from 'devmock-js';
 *
 * DevMock.enable();
 * // use OpenAI, Anthropic, Stripe, SendGrid, Twilio SDKs normally
 * DevMock.inspect().emails()   // captured emails
 * DevMock.inspect().clear()    // reset between tests
 * DevMock.disable()
 */

import { enableInterceptor, disableInterceptor, isEnabled } from './core/interceptor.js';
import { registerService, type ServiceName } from './core/registry.js';
import { inspector } from './core/inspector.js';
import {
  setScenario, clearScenario, clearAllScenarios,
  setNextCall, setSequence, setFailAfter,
  type ServiceScenario,
} from './core/scenario.js';
import {
  setDelay, setStreamDelay, clearDelays,
  type DelayConfig,
} from './core/delay.js';
import { setSeed, resetSeed } from './core/nanoid.js';

import { openaiHandler }    from './services/openai.js';
import { anthropicHandler } from './services/anthropic.js';
import { sendgridHandler }  from './services/sendgrid.js';
import { twilioHandler }    from './services/twilio.js';
import { stripeHandler }    from './services/stripe.js';

// ─── Register all built-in handlers ──────────────────────────────────────────

registerService(openaiHandler);
registerService(anthropicHandler);
registerService(sendgridHandler);
registerService(twilioHandler);
registerService(stripeHandler);

// ─── Public API ───────────────────────────────────────────────────────────────

export const DevMock = {
  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /** Enable HTTP interception. Call before instantiating SDKs. */
  enable(): void {
    enableInterceptor();
    console.log('[devmock] Interceptor enabled. External service calls will be mocked.');
  },

  /** Disable interception and restore original fetch / https.request. */
  disable(): void {
    disableInterceptor();
    clearAllScenarios();
    clearDelays();
    resetSeed();
    console.log('[devmock] Interceptor disabled. Real HTTP calls restored.');
  },

  /** Returns true if the interceptor is currently active. */
  isEnabled(): boolean {
    return isEnabled();
  },

  // ── Scenarios ────────────────────────────────────────────────────────────────

  /**
   * Set a persistent scenario for a service (all calls until cleared).
   * @example DevMock.scenario('stripe', 'card_declined');
   */
  scenario(service: ServiceName, scenario: ServiceScenario): void {
    setScenario(service, scenario);
  },

  /**
   * Override only the NEXT call. Auto-consumed after one use.
   * @example
   * DevMock.onNextCall('stripe', 'card_declined');
   * await stripe.paymentIntents.create(...); // ← declines
   * await stripe.paymentIntents.create(...); // ← back to success
   */
  onNextCall(service: ServiceName, scenario: ServiceScenario): void {
    setNextCall(service, scenario);
  },

  /**
   * Rotate through scenarios in order. Repeats the last item indefinitely.
   * @example
   * DevMock.sequence('openai', ['success', 'success', 'rate_limit']);
   * // call 1 → success, call 2 → success, call 3+ → rate_limit
   */
  sequence(service: ServiceName, scenarios: ServiceScenario[]): void {
    setSequence(service, scenarios);
  },

  /**
   * Succeed N times, then switch to an error scenario permanently.
   * @example
   * DevMock.failAfter('stripe', 2, 'card_declined');
   * // call 1 → success, call 2 → success, call 3+ → card_declined
   */
  failAfter(service: ServiceName, afterN: number, scenario: ServiceScenario): void {
    setFailAfter(service, afterN, scenario);
  },

  /** Reset all scenario state for a service. */
  clearScenario(service: ServiceName): void {
    clearScenario(service);
  },

  // ── Delay ────────────────────────────────────────────────────────────────────

  /**
   * Simulate network latency for a service.
   * @example
   * DevMock.delay('openai', 800);                       // fixed 800ms
   * DevMock.delay('stripe', { min: 100, max: 400 });    // random in range
   * DevMock.delay('*', 200);                            // all services
   * DevMock.delay('openai', 0);                         // remove delay
   */
  delay(service: ServiceName | '*', config: DelayConfig): void {
    setDelay(service, config);
  },

  /**
   * Set the delay between streamed chunks (OpenAI / Anthropic streaming).
   * Default is 10ms per chunk.
   * @example DevMock.streamDelay('openai', 50); // 50ms between words
   */
  streamDelay(service: Extract<ServiceName, 'openai' | 'anthropic'>, ms: number): void {
    setStreamDelay(service, ms);
  },

  // ── Seed ─────────────────────────────────────────────────────────────────────

  /**
   * Seed the ID generator for deterministic, reproducible mock IDs.
   * With the same seed, all generated IDs (payment intent IDs, message IDs,
   * etc.) will be identical across runs — useful for snapshot testing.
   *
   * @example
   * DevMock.seed(42);
   * // pi_mock_xK9mQpLrNvWz  ← always the same for seed 42
   * DevMock.seed(0); // reset to a specific seed
   */
  seed(value: number): void {
    setSeed(value);
  },

  // ── Inspector ────────────────────────────────────────────────────────────────

  /**
   * Access the in-memory log of all intercepted calls.
   * @example
   * DevMock.inspect().emails()    // EmailEntry[]
   * DevMock.inspect().sms()       // SmsEntry[]
   * DevMock.inspect().aiCalls()   // AiCallEntry[]
   * DevMock.inspect().payments()  // PaymentEntry[]
   * DevMock.inspect().clear()     // reset (use in afterEach)
   */
  inspect() {
    return inspector;
  },
};

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type { EmailEntry, SmsEntry, AiCallEntry, PaymentEntry, Inspector } from './core/inspector.js';
export type { ServiceName } from './core/registry.js';
export type { ServiceScenario, StripeScenario, OpenAIScenario, TwilioScenario, AnthropicScenario } from './core/scenario.js';
export type { DelayConfig } from './core/delay.js';
