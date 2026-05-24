/**
 * Scenario system: allows simulating error states, edge cases, and
 * alternative flows without changing application code.
 *
 * Usage:
 *   DevMock.scenario('stripe', 'card_declined');
 *   DevMock.scenario('openai', 'rate_limit');
 *   DevMock.clearScenario('stripe');
 *   DevMock.clearScenarios();
 */

import type { ServiceName } from './registry.js';

export type StripeScenario =
  | 'success'
  | 'card_declined'
  | 'insufficient_funds'
  | 'expired_card'
  | 'processing_error'
  | 'requires_action';  // 3DS flow

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

const activeScenarios = new Map<ServiceName, ServiceScenario>();

export function setScenario(service: ServiceName, scenario: ServiceScenario): void {
  activeScenarios.set(service, scenario);
}

export function getScenario(service: ServiceName): ServiceScenario {
  return activeScenarios.get(service) ?? 'success';
}

export function clearScenario(service: ServiceName): void {
  activeScenarios.delete(service);
}

export function clearAllScenarios(): void {
  activeScenarios.clear();
}
