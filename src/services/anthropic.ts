/**
 * Anthropic service handler.
 * Intercepts: api.anthropic.com
 *
 * Supported endpoints:
 *   POST /v1/messages  (streaming + non-streaming)
 */

import type { ServiceHandler } from '../core/registry.js';
import { inspector } from '../core/inspector.js';
import { nanoid } from '../core/nanoid.js';
import { getScenario } from '../core/scenario.js';

type Message = { role: string; content: string | Array<{ type: string; text: string }> };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractText(content: Message['content']): string {
  if (typeof content === 'string') return content;
  return content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

function buildMockContent(messages: Message[]): string {
  const last = messages.findLast((m) => m.role === 'user');
  const preview = last ? extractText(last.content).slice(0, 60) : '(no user message)';
  return `[devmock] Mock response to: "${preview}"`;
}

function makeHeaders(): Headers {
  return new Headers({
    'content-type': 'application/json',
    'x-request-id': `req_mock_${nanoid()}`,
    'anthropic-version': '2023-06-01',
    'request-id': `req_mock_${nanoid()}`,
  });
}

// ─── Error scenarios ──────────────────────────────────────────────────────────

function errorResponse(scenario: string): Response {
  const errors: Record<string, { status: number; type: string; message: string }> = {
    rate_limit: { status: 429, type: 'rate_limit_error', message: 'Rate limit exceeded. Please retry after a short wait.' },
    overloaded: { status: 529, type: 'overloaded_error', message: 'Anthropic API is temporarily overloaded.' },
    server_error: { status: 500, type: 'api_error', message: 'Internal server error.' },
  };
  const err = errors[scenario] ?? errors['server_error'];
  return new Response(
    JSON.stringify({ type: 'error', error: { type: err.type, message: err.message } }),
    { status: err.status, headers: makeHeaders() }
  );
}

// ─── Non-streaming response ───────────────────────────────────────────────────

function messagesResponse(body: Record<string, unknown>): Response {
  const messages = (body.messages as Message[]) ?? [];
  const model = (body.model as string) ?? 'claude-3-5-sonnet-20241022';
  const content = buildMockContent(messages);
  const inputTokens = messages.reduce((n, m) => n + extractText(m.content).split(' ').length, 0);
  const outputTokens = content.split(' ').length;

  inspector.addAiCall({
    service: 'anthropic',
    model,
    messages: messages.map((m) => ({ role: m.role, content: extractText(m.content) })),
    response: content,
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    timestamp: new Date(),
  });

  return new Response(
    JSON.stringify({
      id: `msg_mock_${nanoid()}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: content }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }),
    { status: 200, headers: makeHeaders() }
  );
}

// ─── Streaming response (SSE - Anthropic format) ──────────────────────────────

function messagesStreamResponse(body: Record<string, unknown>): Response {
  const messages = (body.messages as Message[]) ?? [];
  const model = (body.model as string) ?? 'claude-3-5-sonnet-20241022';
  const content = buildMockContent(messages);
  const words = content.split(' ');
  const msgId = `msg_mock_${nanoid()}`;
  const inputTokens = messages.reduce((n, m) => n + extractText(m.content).split(' ').length, 0);

  inspector.addAiCall({
    service: 'anthropic',
    model,
    messages: messages.map((m) => ({ role: m.role, content: extractText(m.content) })),
    response: content,
    promptTokens: inputTokens,
    completionTokens: words.length,
    timestamp: new Date(),
  });

  // Anthropic SSE format
  const events: string[] = [
    `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { input_tokens: inputTokens, output_tokens: 0 } } })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`,
    ...words.map((word, i) => {
      const chunk = { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: i === 0 ? word : ' ' + word } };
      return `event: content_block_delta\ndata: ${JSON.stringify(chunk)}\n\n`;
    }),
    `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: words.length } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
  ];

  const encoder = new TextEncoder();
  let idx = 0;

  const stream = new ReadableStream({
    async pull(controller) {
      if (idx >= events.length) { controller.close(); return; }
      await new Promise((r) => setTimeout(r, 10));
      controller.enqueue(encoder.encode(events[idx++]));
    },
  });

  return new Response(stream, {
    status: 200,
    headers: new Headers({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-request-id': `req_mock_${nanoid()}`,
    }),
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const anthropicHandler: ServiceHandler = {
  name: 'anthropic',
  hostnames: ['api.anthropic.com'],

  async handleFetch(url: string, init?: RequestInit): Promise<Response> {
    const path = new URL(url).pathname;
    const scenario = getScenario('anthropic') as string;

    if (scenario !== 'success') return errorResponse(scenario);

    if (path === '/v1/messages') {
      const bodyText = typeof init?.body === 'string' ? init.body : '{}';
      const body: Record<string, unknown> = JSON.parse(bodyText || '{}');
      return body.stream ? messagesStreamResponse(body) : messagesResponse(body);
    }

    return new Response(
      JSON.stringify({ note: `devmock: unhandled Anthropic path ${path}` }),
      { status: 200, headers: makeHeaders() }
    );
  },
};
