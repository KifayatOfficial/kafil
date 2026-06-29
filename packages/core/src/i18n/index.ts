// §12 + §25.7 — minimal i18n skeleton. Strings live here as a flat dictionary so
// both mobile and web consume the same source. Pashto + Urdu are RTL.
// In production this graduates to message-format files; the runtime shape stays the same.

import type { Lang } from '../schemas/common';

type StringKey =
  | 'app.name'
  | 'onboarding.welcome'
  | 'onboarding.choose_lang'
  | 'common.continue'
  | 'common.cancel'
  | 'job.apply'
  | 'job.accept'
  | 'job.mark_done'
  | 'review.window_closed'
  | 'error.generic'
  | 'empty.no_jobs'
  | 'safety.report'
  | 'safety.report_title'
  | 'safety.report_user'
  | 'safety.report_job'
  | 'safety.block_user'
  | 'safety.unblock_user'
  | 'safety.blocked_notice'
  | 'safety.reason_scam'
  | 'safety.reason_fee'
  | 'safety.reason_fake'
  | 'safety.reason_offplatform'
  | 'safety.reason_harassment'
  | 'safety.reason_spam'
  | 'safety.reason_other'
  | 'safety.submitted'
  | 'safety.submitted_body';

const dict: Record<Lang, Record<StringKey, string>> = {
  ps: {
    'app.name': 'کافل',
    'onboarding.welcome': 'سلام، کافل ته ښه راغلاست',
    'onboarding.choose_lang': 'خپله ژبه وټاکئ',
    'common.continue': 'دوام',
    'common.cancel': 'لغوه کول',
    'job.apply': 'وغوښتل',
    'job.accept': 'منل',
    'job.mark_done': 'بشپړ شو',
    'review.window_closed': 'د کره کتنې وخت پای ته ورسید',
    'error.generic': 'یوه ستونزه پیښه شوه — بیا وڅیړئ',
    'empty.no_jobs': 'دلته اوس کار نشته — موږ به تاسو خبر کړو',
    'safety.report': 'راپور ورکړئ',
    'safety.report_title': 'څه شی غلط دی؟',
    'safety.report_user': 'د دې کس راپور ورکړئ',
    'safety.report_job': 'د دې کار راپور ورکړئ',
    'safety.block_user': 'بلاک کړئ',
    'safety.unblock_user': 'بلاک لرې کړئ',
    'safety.blocked_notice': 'تاسو دا کس بلاک کړی — پیغامونه تړل شوي دي',
    'safety.reason_scam': 'درغلي / دوکه',
    'safety.reason_fee': 'د پیسو غوښتنه',
    'safety.reason_fake': 'جعلي',
    'safety.reason_offplatform': 'د اپ نه بهر وړل',
    'safety.reason_harassment': 'ځورونه',
    'safety.reason_spam': 'سپام',
    'safety.reason_other': 'بل څه',
    'safety.submitted': 'مننه',
    'safety.submitted_body': 'ستاسو راپور مو ترلاسه کړ. زموږ ټیم به یې وګوري.',
  },
  ur: {
    'app.name': 'کافل',
    'onboarding.welcome': 'السلام علیکم، کافل میں خوش آمدید',
    'onboarding.choose_lang': 'اپنی زبان چنیں',
    'common.continue': 'جاری رکھیں',
    'common.cancel': 'منسوخ کریں',
    'job.apply': 'درخواست دیں',
    'job.accept': 'قبول کریں',
    'job.mark_done': 'مکمل ہو گیا',
    'review.window_closed': 'جائزہ کی مدت ختم ہو گئی',
    'error.generic': 'کچھ غلط ہو گیا — دوبارہ کوشش کریں',
    'empty.no_jobs': 'اس وقت کوئی کام نہیں ہے — ہم آپ کو بتائیں گے',
    'safety.report': 'رپورٹ کریں',
    'safety.report_title': 'کیا غلط ہے؟',
    'safety.report_user': 'اس شخص کی رپورٹ کریں',
    'safety.report_job': 'اس کام کی رپورٹ کریں',
    'safety.block_user': 'بلاک کریں',
    'safety.unblock_user': 'بلاک ہٹائیں',
    'safety.blocked_notice': 'آپ نے اس شخص کو بلاک کیا ہے — پیغامات بند ہیں',
    'safety.reason_scam': 'دھوکہ / فراڈ',
    'safety.reason_fee': 'پیسے کا مطالبہ',
    'safety.reason_fake': 'جعلی',
    'safety.reason_offplatform': 'ایپ سے باہر لے جانا',
    'safety.reason_harassment': 'ہراسانی',
    'safety.reason_spam': 'اسپام',
    'safety.reason_other': 'کچھ اور',
    'safety.submitted': 'شکریہ',
    'safety.submitted_body': 'ہمیں آپ کی رپورٹ مل گئی۔ ہماری ٹیم اسے دیکھے گی۔',
  },
  en: {
    'app.name': 'KAFIL',
    'onboarding.welcome': 'Salaam — welcome to KAFIL',
    'onboarding.choose_lang': 'Choose your language',
    'common.continue': 'Continue',
    'common.cancel': 'Cancel',
    'job.apply': 'Apply',
    'job.accept': 'Accept',
    'job.mark_done': 'Mark done',
    'review.window_closed': 'Review window closed',
    'error.generic': 'Something went wrong — please retry',
    'empty.no_jobs': "No jobs in your area yet — we'll let you know",
    'safety.report': 'Report',
    'safety.report_title': "What's wrong?",
    'safety.report_user': 'Report this person',
    'safety.report_job': 'Report this job',
    'safety.block_user': 'Block',
    'safety.unblock_user': 'Unblock',
    'safety.blocked_notice': "You blocked this person — messaging is closed",
    'safety.reason_scam': 'Scam / fraud',
    'safety.reason_fee': 'Asked me to pay',
    'safety.reason_fake': 'Fake',
    'safety.reason_offplatform': 'Taking it off-app',
    'safety.reason_harassment': 'Harassment',
    'safety.reason_spam': 'Spam',
    'safety.reason_other': 'Something else',
    'safety.submitted': 'Thank you',
    'safety.submitted_body': "We received your report. Our team will review it.",
  },
};

export function t(lang: Lang, key: StringKey): string {
  return dict[lang][key];
}

export const isRtl = (lang: Lang): boolean => lang === 'ps' || lang === 'ur';

export type { StringKey };
