/**
 * Service registry: maps hostnames to service names.
 * Each service handler registers its hostnames here.
 */

export type ServiceName = 'openai' | 'anthropic' | 'sendgrid' | 'twilio' | 'stripe';

export interface ServiceHandler {
  name: ServiceName;
  hostnames: string[];
  handleFetch(url: string, init?: RequestInit): Promise<Response>;
}

const handlers = new Map<ServiceName, ServiceHandler>();
const hostnameIndex = new Map<string, ServiceName>();

export function registerService(handler: ServiceHandler): void {
  handlers.set(handler.name, handler);
  for (const host of handler.hostnames) {
    hostnameIndex.set(host, handler.name);
  }
}

export function detectService(url: string): ServiceHandler | null {
  try {
    const hostname = new URL(url).hostname;
    const name = hostnameIndex.get(hostname);
    if (!name) return null;
    return handlers.get(name) ?? null;
  } catch {
    return null;
  }
}

export function getHandler(name: ServiceName): ServiceHandler | undefined {
  return handlers.get(name);
}
