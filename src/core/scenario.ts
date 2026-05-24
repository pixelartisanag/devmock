/**
 * Scenario system — control what each service call returns.
 *
 * Three layers (applied in priority order):
 *   1. onNextCall  — fires once, then auto-removes
 *   2. sequence    — consumes items in order, repeats last
 *   3. failAfter   — succeeds N times then switches to error scenario
 *   4. global      — DevMock.scenario() persistent override
 *   5. default     — 'success'
 */

import type { ServiceName } from './registry.js';

// ─── Scenario types ───────────────────────────────────────────────────────────

export type StripeScenario =
  | 'success'
  | 'card_declined'
  | 'insufficient_funds'
  | 'expired_card'
  | 'processing_error'
  | 'requires_action';

export type OpenAIScenario =
  | 'success'
  | 'rate_limit'
  | 'context_length_exceeded'
  | 'server_error';

export type TwilioScenario =
  | 'success'
  | 'invalid_number'
  | 'unsubscribed';

export type AnthropicScenario =
  | 'success'
  | 'rate_limit'
  | 'overloaded';

export type ServiceScenario =
  | StripeScenario
  | OpenAIScenario
  | TwilioScenario
  | AnthropicScenario;

// ─── State ────────────────────────────────────────────────────────────────────

// Layer 4 — persistent global
const globalScenarios = new Map<ServiceName, ServiceScenario>();

// Layer 1 — fires once
const nextCallOverrides = new Map<ServiceName, ServiceScenario>();

// Layer 2 — ordered sequence
const sequences = new Map<ServiceName, ServiceScenario[]>();
const sequenceIndexes = new Map<ServiceName, number>();

// Layer 3 — failAfter
interface FailAfterState {
  after: number;
  current: number;
  scenario: ServiceScenario;
}
const failAfterStates = new Map<ServiceName, FailAfterState>();

// ─── Setters ──────────────────────────────────────────────────────────────────

/** Persistent scenario — all calls until cleared. */
export function setScenario(service: ServiceName, scenario: ServiceScenario): void {
  globalScenarios.set(service, scenario);
}

/**
 * Override only the NEXT call for this service.
 * Auto-consumed after one use.
 *
 * @example
 * DevMock.onNextCall('stripe', 'card_declined');
 * await stripe.paymentIntents.create(...); // ← declines
 * await stripe.paymentIntents.create(...); // ← back to success
 */
export function setNextCall(service: ServiceName, scenario: ServiceScenario): void {
  nextCallOverrides.set(service, scenario);
}

/**
 * Rotate through scenarios in order. Repeats the last item indefinitely.
 *
 * @example
 * DevMock.sequence('stripe', ['success', 'success', 'card_declined']);
 * // call 1 → success
 * // call 2 → success
 * // call 3 → card_declined
 * // call 4 → card_declined (repeats last)
 */
export function setSequence(service: ServiceName, scenarios: ServiceScenario[]): void {
  if (scenarios.length === 0) return;
  sequences.set(service, scenarios);
  sequenceIndexes.set(service, 0);
}

/**
 * Succeed N times, then switch to error scenario permanently.
 *
 * @example
 * DevMock.failAfter('openai', 2, 'rate_limit');
 * // call 1 → success
 * // call 2 → success
 * // call 3 → rate_limit
 * // call 4 → rate_limit
 */
export function setFailAfter(
  service: ServiceName,
  afterN: number,
  scenario: ServiceScenario
): void {
  failAfterStates.set(service, { after: afterN, current: 0, scenario });
}

// ─── Clearers ─────────────────────────────────────────────────────────────────

export function clearScenario(service: ServiceName): void {
  globalScenarios.delete(service);
  nextCallOverrides.delete(service);
  sequences.delete(service);
  sequenceIndexes.delete(service);
  failAfterStates.delete(service);
}

export function clearAllScenarios(): void {
  globalScenarios.clear();
  nextCallOverrides.clear();
  sequences.clear();
  sequenceIndexes.clear();
  failAfterStates.clear();
}

// ─── Resolution (called by each handler) ─────────────────────────────────────

export function getScenario(service: ServiceName): ServiceScenario {
  // Layer 1: onNextCall — consume and return
  if (nextCallOverrides.has(service)) {
    const scenario = nextCallOverrides.get(service)!;
    nextCallOverrides.delete(service);
    return scenario;
  }

  // Layer 2: sequence — advance index, clamp to last
  if (sequences.has(service)) {
    const seq = sequences.get(service)!;
    const idx = sequenceIndexes.get(service) ?? 0;
    const scenario = seq[Math.min(idx, seq.length - 1)];
    sequenceIndexes.set(service, idx + 1);
    return scenario;
  }

  // Layer 3: failAfter — count up, then lock to error scenario
  if (failAfterStates.has(service)) {
    const state = failAfterStates.get(service)!;
    if (state.current < state.after) {
      state.current++;
      return globalScenarios.get(service) ?? 'success';
    }
    return state.scenario;
  }

  // Layer 4: global persistent scenario
  return globalScenarios.get(service) ?? 'success';
}
