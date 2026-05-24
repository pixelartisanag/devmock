/**
 * Twilio service handler.
 * Intercepts: api.twilio.com
 *
 * Supported endpoints:
 *   POST /2010-04-01/Accounts/{AccountSid}/Messages
 *   POST /2010-04-01/Accounts/{AccountSid}/Messages.json
 */

import type { ServiceHandler } from '../core/registry.js';
import { inspector } from '../core/inspector.js';
import { nanoid } from '../core/nanoid.js';
import { applyDelay } from '../core/delay.js';

function parseFormBody(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const part of body.split('&')) {
    const [k, v] = part.split('=');
    if (k) params[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent((v ?? '').replace(/\+/g, ' '));
  }
  return params;
}

export const twilioHandler: ServiceHandler = {
  name: 'twilio',
  hostnames: ['api.twilio.com'],

  async handleFetch(url: string, init?: RequestInit): Promise<Response> {
    await applyDelay('twilio');

    const path = new URL(url).pathname;
    const isMessages = /\/2010-04-01\/Accounts\/[^/]+\/Messages(\.json)?$/.test(path);

    if (isMessages && init?.method?.toUpperCase() === 'POST') {
      const bodyText = typeof init.body === 'string' ? init.body : '';
      const params = parseFormBody(bodyText);

      const sid = `SMmock${nanoid(24).toUpperCase()}`;

      inspector.addSms({
        to: params.To ?? 'unknown',
        from: params.From ?? 'devmock',
        body: params.Body ?? '',
        sid,
        timestamp: new Date(),
      });

      const payload = {
        sid,
        account_sid: 'ACmockdevmock000000000000000000000',
        to: params.To,
        from: params.From,
        body: params.Body,
        status: 'queued',
        direction: 'outbound-api',
        date_created: new Date().toUTCString(),
        date_updated: new Date().toUTCString(),
        date_sent: null,
        error_code: null,
        error_message: null,
        uri: `/2010-04-01/Accounts/ACmock/Messages/${sid}.json`,
      };

      return new Response(JSON.stringify(payload), {
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
      });
    }

    return new Response(JSON.stringify({ note: `devmock: unhandled Twilio path ${path}` }), {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
    });
  },
};
