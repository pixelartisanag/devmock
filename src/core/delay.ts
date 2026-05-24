/**
 * Delay system — simulate network latency per service or globally.
 *
 * Usage:
 *   DevMock.delay('openai', 800)                    // fixed 800ms
 *   DevMock.delay('stripe', { min: 100, max: 400 }) // random in range
 *   DevMock.delay('*', 200)                         // all services
 *   DevMock.delay('openai', 0)                      // remove delay for openai
 *   DevMock.clearDelays()                           // remove all
 *
 * Streaming chunk delay:
 *   DevMock.streamDelay('openai', 30)   // 30ms between each streamed word
 */

import type { ServiceName } from './registry.js';

export type DelayConfig = number | { min: number; max: number };

const delays = new Map<string, DelayConfig>();
const streamDelays = new Map<ServiceName, number>();

// ─── Public setters ───────────────────────────────────────────────────────────

export function setDelay(service: ServiceName | '*', config: DelayConfig): void {
  if (config === 0 || (typeof config === 'number' && config <= 0)) {
    delays.delete(service);
  } else {
    delays.set(service, config);
  }
}

export function setStreamDelay(service: ServiceName, ms: number): void {
  if (ms <= 0) {
    streamDelays.delete(service);
  } else {
    streamDelays.set(service, ms);
  }
}

export function clearDelays(): void {
  delays.clear();
  streamDelays.clear();
}

// ─── Runtime helpers ──────────────────────────────────────────────────────────

function resolveMs(config: DelayConfig): number {
  if (typeof config === 'number') return config;
  return config.min + Math.random() * (config.max - config.min);
}

/**
 * Awaits the configured delay for a service (or global '*' fallback).
 * No-op if no delay is configured.
 */
export async function applyDelay(service: ServiceName): Promise<void> {
  const config = delays.get(service) ?? delays.get('*');
  if (config == null) return;
  const ms = resolveMs(config);
  if (ms > 0) await new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * Returns the per-chunk delay for streaming responses.
 * Falls back to 10ms if none configured.
 */
export function getStreamDelay(service: ServiceName): number {
  return streamDelays.get(service) ?? 10;
}
