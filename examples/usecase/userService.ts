/**
 * userService.ts
 *
 * Serviciu real de inregistrare utilizatori.
 * Foloseste:
 *   - OpenAI    → genereaza mesaj de bun venit personalizat
 *   - SendGrid  → trimite email de confirmare cu mesajul generat
 *   - Twilio    → trimite SMS cu cod de verificare 2FA
 *
 * Acest fisier NU stie nimic despre devmock.
 * Este codul "aplicatiei tale" - curat, real, fara mock-uri in el.
 */

import OpenAI from 'openai';
import sgMail from '@sendgrid/mail';
import twilio from 'twilio';

// ─── Config (in productie vine din process.env) ───────────────────────────────

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? 'sk-not-set',
});

sgMail.setApiKey(process.env.SENDGRID_API_KEY ?? 'SG.not-set');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID ?? 'ACnot-set',
  process.env.TWILIO_AUTH_TOKEN ?? 'not-set'
);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RegisterInput {
  name: string;
  email: string;
  phone: string;    // E.164 format: +40712345678
  plan: 'free' | 'pro' | 'enterprise';
}

export interface RegisterResult {
  userId: string;
  verificationCode: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateVerificationCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateUserId(): string {
  return `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Core logic ───────────────────────────────────────────────────────────────

async function generateWelcomeMessage(name: string, plan: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: 'Esti un asistent prietenos pentru o aplicatie SaaS. Scrie mesaje scurte si calde.',
      },
      {
        role: 'user',
        content: `Scrie un mesaj de bun venit de 2 propozitii pentru ${name} care tocmai s-a inregistrat pe planul ${plan}.`,
      },
    ],
    max_tokens: 100,
  });

  return completion.choices[0].message.content ?? `Bun venit, ${name}!`;
}

async function sendWelcomeEmail(
  to: string,
  name: string,
  welcomeMessage: string,
  verificationCode: string
): Promise<void> {
  await sgMail.send({
    to,
    from: { email: 'noreply@myapp.com', name: 'MyApp' },
    subject: `Bun venit la MyApp, ${name}! Confirma-ti contul`,
    text: `${welcomeMessage}\n\nCodul tau de verificare este: ${verificationCode}\n\nEchipa MyApp`,
    html: `
      <h2>${welcomeMessage}</h2>
      <p>Pentru a-ti activa contul, introdu codul de mai jos:</p>
      <h1 style="letter-spacing: 8px; color: #6366f1;">${verificationCode}</h1>
      <p>Codul expira in 10 minute.</p>
    `,
  });
}

async function sendVerificationSms(phone: string, code: string, name: string): Promise<void> {
  await twilioClient.messages.create({
    to: phone,
    from: process.env.TWILIO_FROM_NUMBER ?? '+15005550006',
    body: `MyApp: Salut ${name}! Codul tau de verificare este ${code}. Expira in 10 min.`,
  });
}

// ─── Main exported function ───────────────────────────────────────────────────

export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const { name, email, phone, plan } = input;

  const userId = generateUserId();
  const verificationCode = generateVerificationCode();

  // 1. Genereaza mesaj personalizat cu AI
  const welcomeMessage = await generateWelcomeMessage(name, plan);

  // 2. Trimite email de confirmare cu codul de verificare
  await sendWelcomeEmail(email, name, welcomeMessage, verificationCode);

  // 3. Trimite SMS cu codul 2FA
  await sendVerificationSms(phone, verificationCode, name);

  return { userId, verificationCode };
}
