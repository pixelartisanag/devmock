/**
 * OpenAI service handler.
 * Intercepts: api.openai.com
 *
 * Supported endpoints:
 *   POST /v1/chat/completions  (streaming + non-streaming)
 *   POST /v1/embeddings
 */

import type { ServiceHandler } from '../core/registry.js';
import { inspector } from '../core/inspector.js';
import { nanoid } from '../core/nanoid.js';

type Message = { role: string; content: string };

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildMockContent(messages: Message[]): string {
  const last = messages.findLast((m) => m.role === 'user');
  const preview = last ? last.content.slice(0, 60) : '(no user message)';
  return `[devmock] Mock response to: "${preview}"`;
}

function makeHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    'content-type': 'application/json',
    'x-request-id': `devmock-${nanoid()}`,
    ...extra,
  });
}

// ─── Non-streaming response ──────────────────────────────────────────────────

function chatCompletionResponse(body: Record<string, unknown>): Response {
  const messages = (body.messages as Message[]) ?? [];
  const model = (body.model as string) ?? 'gpt-4';
  const content = buildMockContent(messages);
  const promptTokens = messages.reduce((n, m) => n + String(m.content).split(' ').length, 0);
  const completionTokens = content.split(' ').length;

  inspector.addAiCall({
    service: 'openai',
    model,
    messages,
    response: content,
    promptTokens,
    completionTokens,
    timestamp: new Date(),
  });

  const payload = {
    id: `chatcmpl-mock-${nanoid()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: makeHeaders(),
  });
}

// ─── Streaming response (SSE) ────────────────────────────────────────────────

function chatCompletionStreamResponse(body: Record<string, unknown>): Response {
  const messages = (body.messages as Message[]) ?? [];
  const model = (body.model as string) ?? 'gpt-4';
  const content = buildMockContent(messages);
  const words = content.split(' ');
  const id = `chatcmpl-mock-${nanoid()}`;
  const created = Math.floor(Date.now() / 1000);
  const promptTokens = messages.reduce((n, m) => n + String(m.content).split(' ').length, 0);

  inspector.addAiCall({
    service: 'openai',
    model,
    messages,
    response: content,
    promptTokens,
    completionTokens: words.length,
    timestamp: new Date(),
  });

  // Build the full SSE payload as a string and stream it
  const chunks: string[] = words.map((word, i) => {
    const delta = { role: i === 0 ? 'assistant' : undefined, content: (i === 0 ? word : ' ' + word) };
    const chunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: null }],
    };
    return `data: ${JSON.stringify(chunk)}\n\n`;
  });

  // Final chunk with finish_reason
  chunks.push(
    `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`
  );
  chunks.push('data: [DONE]\n\n');

  const encoder = new TextEncoder();
  let chunkIndex = 0;

  const stream = new ReadableStream({
    async pull(controller) {
      if (chunkIndex >= chunks.length) {
        controller.close();
        return;
      }
      // Small delay to simulate real streaming
      await new Promise((r) => setTimeout(r, 10));
      controller.enqueue(encoder.encode(chunks[chunkIndex++]));
    },
  });

  return new Response(stream, {
    status: 200,
    headers: makeHeaders({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }),
  });
}

// ─── Embeddings ──────────────────────────────────────────────────────────────

function embeddingsResponse(body: Record<string, unknown>): Response {
  const input = body.input as string | string[];
  const inputs = Array.isArray(input) ? input : [input];
  const data = inputs.map((_, i) => ({
    object: 'embedding',
    index: i,
    // 1536-dim vector of small random-ish values (deterministic mock)
    embedding: Array.from({ length: 1536 }, (_, j) => Math.sin(i + j) * 0.1),
  }));

  return new Response(
    JSON.stringify({ object: 'list', data, model: body.model ?? 'text-embedding-ada-002', usage: { prompt_tokens: 8, total_tokens: 8 } }),
    { status: 200, headers: makeHeaders() }
  );
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export const openaiHandler: ServiceHandler = {
  name: 'openai',
  hostnames: ['api.openai.com'],

  async handleFetch(url: string, init?: RequestInit): Promise<Response> {
    const path = new URL(url).pathname;
    const bodyText = typeof init?.body === 'string' ? init.body : await (init?.body as ReadableStream | null)?.getReader().read().then((r) => new TextDecoder().decode(r.value)).catch(() => '{}') ?? '{}';
    const body: Record<string, unknown> = JSON.parse(bodyText || '{}');

    if (path === '/v1/chat/completions') {
      return body.stream ? chatCompletionStreamResponse(body) : chatCompletionResponse(body);
    }

    if (path === '/v1/embeddings') {
      return embeddingsResponse(body);
    }

    // Fallthrough: unknown endpoint, return 200 empty
    return new Response(JSON.stringify({ object: 'mock', note: `devmock: unhandled path ${path}` }), {
      status: 200,
      headers: makeHeaders(),
    });
  },
};
