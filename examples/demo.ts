/**
 * devmock POC - Demo end-to-end
 *
 * Demonstreaza ca interceptia SDK-level functioneaza:
 *   1. OpenAI chat completion (non-streaming)
 *   2. OpenAI chat completion (streaming SSE)
 *   3. SendGrid email capture
 *   4. Twilio SMS capture
 *   5. Inspector - vezi ce s-a "trimis"
 *
 * Ruleaza cu: npm run demo
 */

import { DevMock } from '../src/index.js';

// ─── 1. Activam devmock INAINTE de a importa/instantia SDK-urile ─────────────
DevMock.enable();

// Importam SDK-ul OpenAI dupa ce am activat mockul
// (in practica ar fi import la top, dar ordinea nu conteaza
//  deoarece interceptam la nivel de fetch, nu la nivel de modul)
import OpenAI from 'openai';

// ─── Helpers de afisare ───────────────────────────────────────────────────────
function section(title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}

// ─── 2. OpenAI - Chat Completion (non-streaming) ─────────────────────────────
section('OpenAI Chat Completion (non-streaming)');

const openai = new OpenAI({ apiKey: 'sk-devmock-fake-key-not-real' });

const completion = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Ce este TypeScript?' },
  ],
});

const aiResponse = completion.choices[0].message.content;
ok(`Raspuns AI: ${aiResponse}`);
ok(`Tokens folositi: ${completion.usage?.total_tokens}`);
ok(`Model: ${completion.model}`);

// ─── 3. OpenAI - Streaming ────────────────────────────────────────────────────
section('OpenAI Chat Completion (streaming SSE)');

const stream = await openai.chat.completions.create({
  model: 'gpt-4',
  stream: true,
  messages: [{ role: 'user', content: 'Explica ce este REST API in 3 cuvinte' }],
});

process.stdout.write('  Stream chunks: ');
let fullStreamResponse = '';
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content ?? '';
  fullStreamResponse += delta;
  process.stdout.write(delta);
}
console.log();
ok(`Stream complet: "${fullStreamResponse}"`);

// ─── 4. SendGrid - Email ──────────────────────────────────────────────────────
section('SendGrid Email Capture');

// Simulam un apel SendGrid direct (fara SDK, cu fetch)
const emailResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer SG.devmock-fake-key',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    personalizations: [{ to: [{ email: 'user@example.com' }] }],
    from: { email: 'noreply@myapp.com', name: 'MyApp' },
    subject: 'Bun venit la MyApp!',
    content: [
      { type: 'text/plain', value: 'Salut! Contul tau a fost creat cu succes.' },
      { type: 'text/html', value: '<h1>Salut!</h1><p>Contul tau a fost creat cu succes.</p>' },
    ],
  }),
});

ok(`Status HTTP: ${emailResponse.status} (202 = Accepted)`);
ok(`Message-ID: ${emailResponse.headers.get('x-message-id')}`);

// ─── 5. Twilio - SMS ──────────────────────────────────────────────────────────
section('Twilio SMS Capture');

const smsResponse = await fetch(
  'https://api.twilio.com/2010-04-01/Accounts/ACmock123/Messages.json',
  {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa('ACmock123:devmock-auth-token'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'To=%2B40712345678&From=%2B14155552671&Body=Codul+tau+este%3A+123456',
  }
);

const smsData = await smsResponse.json() as { sid: string; status: string; body: string };
ok(`Status HTTP: ${smsResponse.status} (201 = Created)`);
ok(`SMS SID: ${smsData.sid}`);
ok(`Status SMS: ${smsData.status}`);
ok(`Body SMS: ${smsData.body}`);

// ─── 6. Inspector - raport final ─────────────────────────────────────────────
section('Inspector - Ce s-a "trimis"');

const log = DevMock.inspect();

console.log('\n  AI Calls:');
for (const call of log.aiCalls()) {
  console.log(`    • model=${call.model} tokens=${call.promptTokens + call.completionTokens}`);
  console.log(`      response: "${call.response.slice(0, 60)}..."`);
}

console.log('\n  Emails:');
for (const email of log.emails()) {
  console.log(`    • to=${email.to} subject="${email.subject}"`);
  console.log(`      from=${email.from} id=${email.messageId}`);
}

console.log('\n  SMS:');
for (const sms of log.sms()) {
  console.log(`    • to=${sms.to} sid=${sms.sid}`);
  console.log(`      body="${sms.body}"`);
}

// ─── 7. Clear si verificare ───────────────────────────────────────────────────
section('Clear Inspector (util in afterEach)');

log.clear();
ok(`Dupa clear: ${log.emails().length} emails, ${log.sms().length} sms, ${log.aiCalls().length} ai calls`);

DevMock.disable();

section('SUCCES - POC functional');
console.log(`
  Ceea ce tocmai s-a intamplat:
  • SDK-ul OpenAI a crezut ca vorbeste cu api.openai.com
  • fetch catre SendGrid si Twilio a fost interceptat transparent
  • Zero modificari in "codul aplicatiei" - doar DevMock.enable() la inceput
  • Inspector a capturat tot ce s-a "trimis"
  • NICIO cerere reala nu a plecat catre exterior
`);
