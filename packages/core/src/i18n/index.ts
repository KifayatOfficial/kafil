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
  | 'empty.no_jobs';

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
  },
};

export function t(lang: Lang, key: StringKey): string {
  return dict[lang][key];
}

export const isRtl = (lang: Lang): boolean => lang === 'ps' || lang === 'ur';

export type { StringKey };
