// Tests for the PII redactor. These guard the §5 / §24/B1 anti-disintermediation surface:
// false negatives = revenue leakage; false positives = frustrated users.
//
// We test:
//   - Phones in many obfuscated forms (Eastern-Arabic, spelled-out, separators).
//   - URLs / social handles / emails.
//   - Fee patterns (§10/F1) — the strongest-warning placeholder.
//   - Neutral text passes through.

import { describe, expect, it } from 'vitest';
import { redact } from '../pii-redactor';

describe('PII redactor — phones', () => {
  it('catches a plain +92 number', () => {
    const r = redact('Call me at +923001234567');
    expect(r.flagged).toBe(true);
    expect(r.redacted).not.toContain('923001234567');
    expect(r.hits.some((h) => h.kind === 'phone')).toBe(true);
  });

  it('catches a number with dashes and spaces', () => {
    const r = redact('contact 0300-123-4567');
    expect(r.flagged).toBe(true);
    expect(r.redacted).not.toContain('4567');
  });

  it('catches Eastern-Arabic digits', () => {
    const r = redact('phone ۰۳۰۰۱۲۳۴۵۶۷ please');
    expect(r.flagged).toBe(true);
    // The placeholder should be present and the digits should not.
    expect(/[٠-٩۰-۹]/.test(r.redacted)).toBe(false);
    expect(r.redacted).toContain('phone');
    expect(r.redacted).toContain('please');
  });

  it('catches spelled-out digits ("oh three zero zero one two ...")', () => {
    const r = redact('reach me at zero three zero zero one two three four five six seven');
    expect(r.flagged).toBe(true);
    expect(r.hits.some((h) => h.kind === 'phone')).toBe(true);
  });

  it('does NOT redact a job rate like "3500 PKR/day"', () => {
    const r = redact('I pay 3500 PKR per day for 3 days');
    expect(r.flagged).toBe(false);
    expect(r.redacted).toContain('3500');
  });
});

describe('PII redactor — urls / social / email', () => {
  it('catches https URL', () => {
    const r = redact('see https://example.com/portfolio');
    expect(r.flagged).toBe(true);
    expect(r.redacted).not.toContain('example.com');
  });

  it('catches www URL', () => {
    const r = redact('visit www.contractor.pk now');
    expect(r.flagged).toBe(true);
  });

  it('catches Telegram + WhatsApp deep-links', () => {
    expect(redact('chat at t.me/me').flagged).toBe(true);
    expect(redact('wa.me/923001234567').flagged).toBe(true);
  });

  it('catches @-handles', () => {
    const r = redact('dm me @myhandle for details');
    expect(r.flagged).toBe(true);
    expect(r.hits.some((h) => h.kind === 'social')).toBe(true);
  });

  it('catches emails', () => {
    const r = redact('email me at foo.bar@example.com');
    expect(r.flagged).toBe(true);
  });
});

describe('PII redactor — fee patterns (§10/F1)', () => {
  it('flags "registration fee" with the stronger placeholder', () => {
    const r = redact('First pay 500 registration fee, then I will hire you');
    expect(r.flagged).toBe(true);
    // The fee placeholder is louder, mentioning "KAFIL never asks workers to pay".
    expect(r.redacted).toContain('never asks workers to pay');
  });

  it('flags "deposit" and "advance"', () => {
    expect(redact('need a deposit first').flagged).toBe(true);
    expect(redact('pay an advance and I will start').flagged).toBe(true);
  });

  it('signals the fee_pattern kind, weighted highest', () => {
    const r = redact('joining fee 1000 rupees');
    expect(r.hits.some((h) => h.kind === 'fee_pattern')).toBe(true);
  });
});

describe('PII redactor — neutral text passes through', () => {
  it.each([
    'Salaam — when can you start?',
    'I am available Monday morning.',
    'Bring your own tools please.',
    'Need 3 masons for a 5-day job in Mingora.',
  ])('passes "%s" untouched', (msg) => {
    const r = redact(msg);
    expect(r.flagged).toBe(false);
    expect(r.redacted).toBe(msg);
  });

  it('returns empty for empty input without crashing', () => {
    const r = redact('');
    expect(r.flagged).toBe(false);
    expect(r.redacted).toBe('');
  });
});
