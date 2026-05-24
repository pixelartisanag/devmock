/**
 * SendGrid service handler.
 * Intercepts: api.sendgrid.com
 *
 * Supported endpoints:
 *   POST /v3/mail/send
 */

import type { ServiceHandler } from '../core/registry.js';
import { inspector } from '../core/inspector.js';
import { nanoid } from '../core/nanoid.js';
import { applyDelay } from '../core/delay.js';

// SendGrid v3 /mail/send body shape (simplified)
interface SendGridBody {
  personalizations?: Array<{ to?: Array<{ email: string }> }>;
  from?: { email: string; name?: string };
  subject?: string;
  content?: Array<{ type: string; value: string }>;
  // Legacy fields
  to?: string;
}

function extractTo(body: SendGridBody): string | string[] {
  const toList = body.personalizations?.[0]?.to?.map((t) => t.email);
  if (toList?.length) return toList.length === 1 ? toList[0] : toList;
  return body.to ?? 'unknown@devmock.local';
}

function extractBody(body: SendGridBody): { text: string; html?: string } {
  const text = body.content?.find((c) => c.type === 'text/plain')?.value ?? '';
  const html = body.content?.find((c) => c.type === 'text/html')?.value;
  return { text, html };
}

export const sendgridHandler: ServiceHandler = {
  name: 'sendgrid',
  hostnames: ['api.sendgrid.com'],

  async handleFetch(url: string, init?: RequestInit): Promise<Response> {
    await applyDelay('sendgrid');

    const path = new URL(url).pathname;

    if (path === '/v3/mail/send' && init?.method?.toUpperCase() === 'POST') {
      const bodyText = typeof init.body === 'string' ? init.body : '{}';
      const body: SendGridBody = JSON.parse(bodyText);

      const { text, html } = extractBody(body);
      const messageId = `devmock-msg-${nanoid()}`;

      inspector.addEmail({
        to: extractTo(body),
        from: body.from?.email ?? 'noreply@devmock.local',
        subject: body.subject ?? '(no subject)',
        body: text,
        html,
        timestamp: new Date(),
        messageId,
      });

      // SendGrid returns 202 Accepted with no body on success
      return new Response(null, {
        status: 202,
        headers: new Headers({
          'x-message-id': messageId,
        }),
      });
    }

    return new Response(JSON.stringify({ note: `devmock: unhandled SendGrid path ${path}` }), {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
    });
  },
};
