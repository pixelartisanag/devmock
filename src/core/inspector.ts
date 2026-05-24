/**
 * Inspector: in-memory log of all intercepted calls.
 * Developers use this in tests to assert what was "sent".
 */

export interface EmailEntry {
  to: string | string[];
  from: string;
  subject: string;
  body: string;
  html?: string;
  timestamp: Date;
  messageId: string;
}

export interface SmsEntry {
  to: string;
  from: string;
  body: string;
  sid: string;
  timestamp: Date;
}

export interface AiCallEntry {
  service: 'openai' | 'anthropic';
  model: string;
  messages: Array<{ role: string; content: string }>;
  response: string;
  promptTokens: number;
  completionTokens: number;
  timestamp: Date;
}

export interface PaymentEntry {
  id: string;
  amount: number;
  currency: string;
  status: string;
  timestamp: Date;
}

export interface Inspector {
  emails(): Readonly<EmailEntry[]>;
  sms(): Readonly<SmsEntry[]>;
  aiCalls(): Readonly<AiCallEntry[]>;
  payments(): Readonly<PaymentEntry[]>;
  addEmail(entry: EmailEntry): void;
  addSms(entry: SmsEntry): void;
  addAiCall(entry: AiCallEntry): void;
  addPayment(entry: PaymentEntry): void;
  clear(): void;
}

class InspectorStore implements Inspector {
  // Using protected instead of private to avoid DTS export errors
  protected _emails: EmailEntry[] = [];
  protected _sms: SmsEntry[] = [];
  protected _aiCalls: AiCallEntry[] = [];
  protected _payments: PaymentEntry[] = [];

  emails(): Readonly<EmailEntry[]> {
    return this._emails;
  }

  sms(): Readonly<SmsEntry[]> {
    return this._sms;
  }

  aiCalls(): Readonly<AiCallEntry[]> {
    return this._aiCalls;
  }

  payments(): Readonly<PaymentEntry[]> {
    return this._payments;
  }

  addEmail(entry: EmailEntry): void {
    this._emails.push(entry);
  }

  addSms(entry: SmsEntry): void {
    this._sms.push(entry);
  }

  addAiCall(entry: AiCallEntry): void {
    this._aiCalls.push(entry);
  }

  addPayment(entry: PaymentEntry): void {
    this._payments.push(entry);
  }

  clear(): void {
    this._emails = [];
    this._sms = [];
    this._aiCalls = [];
    this._payments = [];
  }
}

export const inspector: Inspector = new InspectorStore();
