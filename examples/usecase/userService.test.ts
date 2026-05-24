/**
 * userService.test.ts
 *
 * Teste pentru flow-ul de inregistrare.
 *
 * FARA devmock: ai nevoie de OPENAI_API_KEY reala ($$$), SENDGRID_API_KEY,
 *               TWILIO credentials. Fiecare rulare de test costa bani.
 *
 * CU devmock: zero credentiale, zero cost, zero cereri reale.
 *             Testele ruleaza in ~50ms in loc de ~3-5 secunde.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { DevMock } from '../../src/index.js';
import { registerUser } from './userService.js';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  DevMock.enable();
});

afterEach(() => {
  // Reset intre teste - ca fiecare test sa inceapa curat
  DevMock.inspect().clear();
});

afterAll(() => {
  DevMock.disable();
});

// ─── Teste ────────────────────────────────────────────────────────────────────

describe('registerUser()', () => {

  it('returneaza userId si verificationCode valide', async () => {
    const result = await registerUser({
      name: 'Razvan',
      email: 'razvan@example.com',
      phone: '+40712345678',
      plan: 'pro',
    });

    expect(result.userId).toMatch(/^usr_/);
    expect(result.verificationCode).toMatch(/^\d{6}$/);
  });

  it('trimite exact 1 email de bun venit', async () => {
    await registerUser({
      name: 'Maria',
      email: 'maria@example.com',
      phone: '+40799999999',
      plan: 'free',
    });

    const emails = DevMock.inspect().emails();
    expect(emails).toHaveLength(1);
  });

  it('emailul ajunge la adresa corecta', async () => {
    await registerUser({
      name: 'Ion',
      email: 'ion@company.ro',
      phone: '+40722222222',
      plan: 'enterprise',
    });

    const [email] = DevMock.inspect().emails();
    expect(email.to).toBe('ion@company.ro');
    expect(email.from).toBe('noreply@myapp.com');
    expect(email.subject).toContain('Ion');
    expect(email.subject).toContain('Confirma');
  });

  it('emailul contine codul de verificare', async () => {
    const { verificationCode } = await registerUser({
      name: 'Ana',
      email: 'ana@test.com',
      phone: '+40711111111',
      plan: 'pro',
    });

    const [email] = DevMock.inspect().emails();
    // Codul din email trebuie sa fie acelasi cu cel returnat
    expect(email.body).toContain(verificationCode);
    expect(email.html).toContain(verificationCode);
  });

  it('trimite exact 1 SMS de verificare', async () => {
    await registerUser({
      name: 'Vlad',
      email: 'vlad@test.com',
      phone: '+40733333333',
      plan: 'free',
    });

    const smsList = DevMock.inspect().sms();
    expect(smsList).toHaveLength(1);
  });

  it('SMS-ul ajunge pe numarul corect si contine codul', async () => {
    const { verificationCode } = await registerUser({
      name: 'Ioana',
      email: 'ioana@test.com',
      phone: '+40744444444',
      plan: 'pro',
    });

    const [sms] = DevMock.inspect().sms();
    expect(sms.to).toBe('+40744444444');
    expect(sms.body).toContain(verificationCode);
    expect(sms.body).toContain('Ioana');
  });

  it('apeleaza AI exact o data per inregistrare', async () => {
    await registerUser({
      name: 'Dan',
      email: 'dan@test.com',
      phone: '+40755555555',
      plan: 'enterprise',
    });

    const aiCalls = DevMock.inspect().aiCalls();
    expect(aiCalls).toHaveLength(1);
    expect(aiCalls[0].model).toBe('gpt-4');
  });

  it('mesajul AI este inclus in emailul trimis', async () => {
    await registerUser({
      name: 'Cristina',
      email: 'cristina@test.com',
      phone: '+40766666666',
      plan: 'pro',
    });

    const [aiCall] = DevMock.inspect().aiCalls();
    const [email] = DevMock.inspect().emails();

    // Raspunsul AI trebuie sa apara in corpul emailului
    expect(email.body).toContain(aiCall.response);
    expect(email.html).toContain(aiCall.response);
  });

  it('inregistrari multiple nu se interfereaza intre ele', async () => {
    await registerUser({ name: 'User1', email: 'u1@test.com', phone: '+40700000001', plan: 'free' });
    await registerUser({ name: 'User2', email: 'u2@test.com', phone: '+40700000002', plan: 'pro' });
    await registerUser({ name: 'User3', email: 'u3@test.com', phone: '+40700000003', plan: 'enterprise' });

    const emails = DevMock.inspect().emails();
    const smsList = DevMock.inspect().sms();
    const aiCalls = DevMock.inspect().aiCalls();

    expect(emails).toHaveLength(3);
    expect(smsList).toHaveLength(3);
    expect(aiCalls).toHaveLength(3);

    // Fiecare email a ajuns la destinatarul corect
    expect(emails.map(e => e.to)).toEqual(['u1@test.com', 'u2@test.com', 'u3@test.com']);
    // Fiecare SMS pe numarul corect
    expect(smsList.map(s => s.to)).toEqual(['+40700000001', '+40700000002', '+40700000003']);
  });

});
