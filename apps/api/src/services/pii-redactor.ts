// PII redactor for in-app chat (§5, §24/B1, §26/M5).
//
// Goals (in priority order):
//   1. Catch obvious phone-number sharing in Pashto/Urdu/English. Regex-defeating tricks
//      (spelled-out digits, Eastern-Arabic numerals, dot/dash separators) are normalized
//      BEFORE matching so the pattern surface is small.
//   2. Catch URLs and common social handles (Telegram, WhatsApp deep-links).
//   3. Do NOT block neutral text. False positives have a worse failure mode than a few
//      misses (the user retypes "contact me" and the platform looks broken).
//   4. Cost: cheap (no ML in v0; we add OCR + image-class detection on a separate path).
//
// Output contract:
//   { redacted: string, flagged: boolean, hits: Array<{kind, snippet}> }
//   - `redacted` is what gets stored in messages.bodyRedacted and shown to the recipient.
//   - `flagged` triggers a fraud_signals row (§24/B1) and a soft warning to the sender.
//   - `hits` is moderator-only context, useful for ops review.
//
// The raw, un-redacted body is still stored in messages.body for moderation use ONLY;
// readers see body_redacted. (See review query in chat.service.)

export interface RedactionHit {
  kind: 'phone' | 'url' | 'social' | 'email' | 'fee_pattern';
  snippet: string;
  /** Index in the NORMALIZED text where the hit starts. */
  start: number;
}

export interface RedactionResult {
  redacted: string;
  flagged: boolean;
  hits: RedactionHit[];
}

const PLACEHOLDER = '[hidden — share contact only after job is confirmed]';
const PLACEHOLDER_FEE = '[hidden — KAFIL never asks workers to pay; please report this]';

// 1) Normalize: Eastern-Arabic / Urdu digits → ASCII, NFC unicode form, lowercase URL parts.
const DIGIT_MAP: Record<string, string> = {
  // Arabic-Indic digits (Urdu/Pashto often use these)
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  // Extended Arabic-Indic (Persian/Urdu numerals)
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

// Spelled-out digits in English / common transliterations. Bare minimum that catches
// real-world bypass attempts — extending this is cheap and additive.
const WORDS_TO_DIGITS: Array<[RegExp, string]> = [
  [/\bzero\b/gi, '0'],
  [/\bone\b/gi, '1'],
  [/\btwo\b/gi, '2'],
  [/\bthree\b/gi, '3'],
  [/\bfour\b/gi, '4'],
  [/\bfive\b/gi, '5'],
  [/\bsix\b/gi, '6'],
  [/\bseven\b/gi, '7'],
  [/\beight\b/gi, '8'],
  [/\bnine\b/gi, '9'],
  // Urdu/Pashto Roman transliterations occasionally used in chat. Conservative.
  [/\bsifr\b/gi, '0'], [/\baik\b/gi, '1'], [/\bdo\b/gi, '2'], [/\bteen\b/gi, '3'],
  [/\bchar\b/gi, '4'], [/\bpanch\b/gi, '5'], [/\bcheh\b/gi, '6'], [/\bsaat\b/gi, '7'],
  [/\baath\b/gi, '8'], [/\bnau\b/gi, '9'],
];

function normalize(text: string): string {
  // 1. Unicode NFC + map Arabic digit blocks.
  let out = text.normalize('NFC');
  out = out.replace(/[٠-٩۰-۹]/g, (d) => DIGIT_MAP[d] ?? d);
  // 2. Spelled-out digits → ASCII digits.
  for (const [re, repl] of WORDS_TO_DIGITS) out = out.replace(re, repl);
  return out;
}

// 2) Detectors. Each runs against the NORMALIZED text and returns hits.

const PHONE_DETECTORS: Array<{ re: RegExp; min: number }> = [
  // +92 with or without separators, allowing intentional noise (spaces, dots, dashes).
  // Require enough digits to be a real PK mobile (10 after +92, sometimes 11 with leading 0).
  { re: /\+?\s*9\s*2[\s\.\-]?[3]?[\s\.\-]?\d(?:[\s\.\-]?\d){8,10}/g, min: 10 },
  // Local PK mobile: 03XXXXXXXXX with separators allowed.
  { re: /0\s*3(?:[\s\.\-]?\d){8,9}/g, min: 9 },
  // Generic "any run of ≥7 digits, possibly separated" — last-resort net.
  // We pull out hits and verify the digit count to avoid stomping on rates/dates.
  { re: /(?:\d[\s\.\-]?){7,}/g, min: 7 },
];

const URL_DETECTOR = /\b(?:https?:\/\/|www\.)\S+/gi;

// Social handles + deep-links. The @-handle alternative uses (?<=\s|^) instead of \b
// because \b before `@` doesn't match (@ isn't a word char). Length ≥3 to avoid email
// false-positives (the email detector runs separately).
const SOCIAL_DETECTOR =
  /\b(?:t\.me\/|telegram\.me\/|whatsapp\.com\/|wa\.me\/)\S+|(?:^|\s)@[a-z0-9_.]{3,}/gi;

const EMAIL_DETECTOR = /\b[a-z0-9_.+\-]+@[a-z0-9\-]+\.[a-z0-9\.\-]+\b/gi;

// §10/F1 — workers never pay to apply. Detect fee/deposit/advance asks.
const FEE_PATTERN_DETECTOR =
  /\b(?:fee|fees|deposit|advance|registration|joining fee|charges|pay first|pay before|jamayat)\b/gi;

function countDigits(s: string): number {
  let n = 0;
  for (const ch of s) if (ch >= '0' && ch <= '9') n++;
  return n;
}

export function redact(input: string): RedactionResult {
  if (!input || typeof input !== 'string') return { redacted: input ?? '', flagged: false, hits: [] };

  const normalized = normalize(input);
  const hits: RedactionHit[] = [];
  const ranges: Array<{ start: number; end: number; replacement: string }> = [];

  // Phones — try each detector; require min-digits so we don't redact rates/dates.
  for (const { re, min } of PHONE_DETECTORS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalized)) !== null) {
      if (countDigits(m[0]) >= min) {
        hits.push({ kind: 'phone', snippet: m[0], start: m.index });
        ranges.push({ start: m.index, end: m.index + m[0].length, replacement: PLACEHOLDER });
      }
    }
  }

  // URLs, social handles, emails.
  for (const [re, kind] of [
    [URL_DETECTOR, 'url'] as const,
    [SOCIAL_DETECTOR, 'social'] as const,
    [EMAIL_DETECTOR, 'email'] as const,
  ]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalized)) !== null) {
      hits.push({ kind, snippet: m[0], start: m.index });
      ranges.push({ start: m.index, end: m.index + m[0].length, replacement: PLACEHOLDER });
    }
  }

  // Fee patterns — different placeholder (stronger F1 messaging).
  FEE_PATTERN_DETECTOR.lastIndex = 0;
  let fm: RegExpExecArray | null;
  while ((fm = FEE_PATTERN_DETECTOR.exec(normalized)) !== null) {
    hits.push({ kind: 'fee_pattern', snippet: fm[0], start: fm.index });
    ranges.push({ start: fm.index, end: fm.index + fm[0].length, replacement: PLACEHOLDER_FEE });
  }

  // Merge overlapping ranges and produce the redacted string.
  ranges.sort((a, b) => a.start - b.start);
  const merged: typeof ranges = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && r.start <= prev.end) {
      // Overlap — keep the wider placeholder (fee_pattern wins over generic redact).
      prev.end = Math.max(prev.end, r.end);
      if (r.replacement === PLACEHOLDER_FEE) prev.replacement = PLACEHOLDER_FEE;
    } else {
      merged.push({ ...r });
    }
  }

  let redacted = '';
  let cursor = 0;
  for (const r of merged) {
    redacted += normalized.slice(cursor, r.start) + r.replacement;
    cursor = r.end;
  }
  redacted += normalized.slice(cursor);

  return { redacted, flagged: hits.length > 0, hits };
}
