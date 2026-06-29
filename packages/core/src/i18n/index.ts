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
  | 'safety.submitted_body'
  | 'wallet.title'
  | 'wallet.balance'
  | 'wallet.withdraw'
  | 'wallet.amount'
  | 'wallet.withdraw_all'
  | 'wallet.recent'
  | 'wallet.none'
  | 'wallet.sent'
  | 'wallet.kyc_required'
  | 'wallet.cooldown'
  | 'wallet.success_title'
  | 'common.back'
  | 'common.send'
  | 'common.sign_out'
  | 'common.loading'
  | 'common.message_placeholder'
  | 'common.tap_all'
  | 'nav.home'
  | 'nav.activity'
  | 'nav.chats'
  | 'nav.messages'
  | 'nav.chat'
  | 'nav.post_job'
  | 'security.cooldown_title'
  | 'security.cooldown_body'
  | 'onboarding.otp_title'
  | 'onboarding.sms_notice'
  | 'onboarding.role_prompt'
  | 'onboarding.role_subtitle'
  | 'onboarding.role_worker'
  | 'onboarding.role_employer'
  | 'onboarding.specialties_title'
  | 'chat.welcome'
  | 'chat.empty'
  | 'job.post_title'
  | 'job.post_subtitle'
  | 'job.live_immediately'
  | 'job.applied'
  | 'job.posted'
  | 'activity.title'
  | 'activity.applications'
  | 'activity.my_jobs'
  | 'activity.no_applications'
  | 'activity.no_jobs'
  | 'applicants.empty'
  | 'applicants.accept'
  | 'applicants.accepted'
  | 'applicants.no_slot'
  | 'job.not_accepting'
  | 'job.stale_title'
  | 'job.stale_body'
  | 'job.back_to_jobs'
  | 'offline.apply_will_send'
  | 'offline.queued'
  | 'offline.banner'
  | 'chat.no_messages';

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
    'wallet.title': 'زما بټوه',
    'wallet.balance': 'موجوده بیلانس',
    'wallet.withdraw': 'پیسې وباسئ',
    'wallet.amount': 'اندازه (روپۍ)',
    'wallet.withdraw_all': 'ټول وباسئ',
    'wallet.recent': 'وروستي اخیستنې',
    'wallet.none': 'تر اوسه هیڅ اخیستنه نشته',
    'wallet.sent': 'ولېږل شو',
    'wallet.kyc_required': 'د پیسو ایستلو لپاره د شناختي کارت تصدیق اړین دی',
    'wallet.cooldown': 'د نوي وسیلې له امله د پیسو حرکت ۲۴ ساعته بند دی',
    'wallet.success_title': 'پیسې ولېږل شوې!',
    'common.back': 'شاته',
    'common.send': 'ولېږئ',
    'common.sign_out': 'وتل',
    'common.loading': 'لیکل کیږي…',
    'common.message_placeholder': 'پیغام ولیکئ',
    'common.tap_all': 'هرڅه چې مناسب وي وټاکئ',
    'nav.home': 'کور',
    'nav.activity': 'فعالیت',
    'nav.chats': 'خبرې',
    'nav.messages': 'پیغامونه',
    'nav.chat': 'خبرې',
    'nav.post_job': '+ کار',
    'security.cooldown_title': 'نوی وسیله — د خوندیتوب ځنډ',
    'security.cooldown_body': 'ستاسو د خوندیتوب لپاره، د نوي وسیلې څخه د ننوتلو وروسته د ۲۴ ساعتونو لپاره د پیسو کارونه بند دي. لټون او خبرې عادي کار کوي.',
    'onboarding.otp_title': '۶ عددي کوډ ولیکئ',
    'onboarding.sms_notice': 'موږ به ستاسو فون ته ۶ عددي کوډ ولېږو. د SMS عادي نرخونه تطبیق کیدی شي.',
    'onboarding.role_prompt': 'کافل به څنګه کاروئ؟',
    'onboarding.role_subtitle': 'تاسو دواړه کولی شئ — نن چې مناسب وي هغه وټاکئ.',
    'onboarding.role_worker': 'کار غواړم',
    'onboarding.role_employer': 'کارګر غواړم',
    'onboarding.specialties_title': 'تاسو څه کار کوئ؟',
    'chat.welcome': 'د پیل لپاره سلام ووایاست.',
    'chat.empty': 'تر اوسه هیڅ خبرې نشته. کله چې یو کارفرما ستاسو غوښتنه ومني — یا تاسو یو کارګر ومنئ — خبرې پخپله پیل کیږي.',
    'job.post_title': 'کار خپور کړئ',
    'job.post_subtitle': 'تشریح کړئ چې څه ته اړتیا لرئ. دقیق اوسئ.',
    'job.live_immediately': 'ستاسو کار به سمدلاسه فعال شي.',
    'job.applied': 'وغوښتل شو!',
    'job.posted': 'کار خپور شو!',
    'activity.title': 'زما فعالیت',
    'activity.applications': 'غوښتنې',
    'activity.my_jobs': 'زما کارونه',
    'activity.no_applications': 'تر اوسه مو هیڅ غوښتنه نه ده کړې.',
    'activity.no_jobs': 'تر اوسه مو هیڅ کار نه دی خپور کړی.',
    'applicants.empty': 'تر اوسه هیڅ غوښتونکی نشته — دا کار شریک کړئ.',
    'applicants.accept': 'ومنئ',
    'applicants.accepted': 'منل شوی',
    'applicants.no_slot': 'خالي ځای نشته',
    'job.not_accepting': 'دا کار اوس مهال غوښتنې نه مني.',
    'job.stale_title': 'دا کار ډک شو',
    'job.stale_body': 'دا کار بل کارګر ونیو — یا تاسو دمخه غوښتنه کړې. نږدې ورته بل وګورئ.',
    'job.back_to_jobs': 'بیرته کارونو ته',
    'offline.apply_will_send': 'تاسو آفلاین یاست. ستاسو غوښتنه به وساتل شي او کله چې انټرنیټ بیرته راشي خپله ولېږل کیږي.',
    'offline.queued': 'په قطار کې — به ولېږل شي',
    'offline.banner': 'آفلاین — بدلونونه ساتل کیږي',
    'chat.no_messages': 'تر اوسه پیغام نشته',
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
    'wallet.title': 'میرا والیٹ',
    'wallet.balance': 'موجودہ بیلنس',
    'wallet.withdraw': 'رقم نکالیں',
    'wallet.amount': 'رقم (روپے)',
    'wallet.withdraw_all': 'سب نکالیں',
    'wallet.recent': 'حالیہ نکالیاں',
    'wallet.none': 'ابھی تک کوئی نکالی نہیں',
    'wallet.sent': 'بھیج دیا گیا',
    'wallet.kyc_required': 'رقم نکالنے کے لیے شناختی کارد کی تصدیق ضروری ہے',
    'wallet.cooldown': 'نئے آلے کی وجہ سے رقم کی منتقلی 24 گھنٹے بند ہے',
    'wallet.success_title': 'رقم بھیج دی گئی!',
    'common.back': 'واپس',
    'common.send': 'بھیجیں',
    'common.sign_out': 'سائن آؤٹ',
    'common.loading': 'لوڈ ہو رہا ہے…',
    'common.message_placeholder': 'پیغام لکھیں',
    'common.tap_all': 'جو لاگو ہوں سب منتخب کریں',
    'nav.home': 'ہوم',
    'nav.activity': 'سرگرمی',
    'nav.chats': 'چیٹس',
    'nav.messages': 'پیغامات',
    'nav.chat': 'چیٹ',
    'nav.post_job': '+ کام',
    'security.cooldown_title': 'نیا آلہ — سیکیورٹی وقفہ',
    'security.cooldown_body': 'آپ کی حفاظت کے لیے، نئے آلے پر سائن ان کے بعد 24 گھنٹے رقم کے کام بند ہیں۔ براؤزنگ اور چیٹ معمول کے مطابق کام کرتے ہیں۔',
    'onboarding.otp_title': '6 ہندسوں کا کوڈ درج کریں',
    'onboarding.sms_notice': 'ہم آپ کے فون پر 6 ہندسوں کا کوڈ بھیجیں گے۔ معیاری SMS نرخ لاگو ہو سکتے ہیں۔',
    'onboarding.role_prompt': 'آپ کافل کیسے استعمال کریں گے؟',
    'onboarding.role_subtitle': 'آپ دونوں کر سکتے ہیں — جو آج مناسب ہو منتخب کریں۔',
    'onboarding.role_worker': 'میں کام تلاش کرنا چاہتا ہوں',
    'onboarding.role_employer': 'میں کارکن رکھنا چاہتا ہوں',
    'onboarding.specialties_title': 'آپ کیا کام کرتے ہیں؟',
    'chat.welcome': 'شروع کرنے کے لیے سلام کہیں۔',
    'chat.empty': 'ابھی تک کوئی گفتگو نہیں۔ جب کوئی آجر آپ کی درخواست قبول کرے — یا آپ کسی کارکن کو قبول کریں — چیٹ خود بخود کھل جاتی ہے۔',
    'job.post_title': 'کام پوسٹ کریں',
    'job.post_subtitle': 'بتائیں آپ کو کیا چاہیے۔ واضح رہیں۔',
    'job.live_immediately': 'آپ کا کام فوراً لائیو ہو جائے گا۔',
    'job.applied': 'درخواست دے دی!',
    'job.posted': 'کام پوسٹ ہو گیا!',
    'activity.title': 'میری سرگرمی',
    'activity.applications': 'درخواستیں',
    'activity.my_jobs': 'میرے کام',
    'activity.no_applications': 'آپ نے ابھی تک کسی چیز کے لیے درخواست نہیں دی۔',
    'activity.no_jobs': 'آپ نے ابھی تک کوئی کام پوسٹ نہیں کیا۔',
    'applicants.empty': 'ابھی تک کوئی درخواست گزار نہیں — یہ کام شیئر کریں۔',
    'applicants.accept': 'قبول کریں',
    'applicants.accepted': 'قبول شدہ',
    'applicants.no_slot': 'کوئی خالی جگہ نہیں',
    'job.not_accepting': 'یہ کام اس وقت درخواستیں قبول نہیں کر رہا۔',
    'job.stale_title': 'یہ کام بھر گیا',
    'job.stale_body': 'یہ کام کسی اور کارکن نے لے لیا — یا آپ پہلے درخواست دے چکے ہیں۔ قریب کوئی ملتا جلتا دیکھیں۔',
    'job.back_to_jobs': 'کاموں پر واپس',
    'offline.apply_will_send': 'آپ آف لائن ہیں۔ آپ کی درخواست محفوظ ہو جائے گی اور انٹرنیٹ واپس آتے ہی خود بھیج دی جائے گی۔',
    'offline.queued': 'قطار میں — بھیجی جائے گی',
    'offline.banner': 'آف لائن — تبدیلیاں محفوظ ہو رہی ہیں',
    'chat.no_messages': 'ابھی تک کوئی پیغام نہیں',
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
    'wallet.title': 'My wallet',
    'wallet.balance': 'Available balance',
    'wallet.withdraw': 'Withdraw',
    'wallet.amount': 'Amount (PKR)',
    'wallet.withdraw_all': 'Withdraw all',
    'wallet.recent': 'Recent withdrawals',
    'wallet.none': 'No withdrawals yet',
    'wallet.sent': 'Sent',
    'wallet.kyc_required': 'Cash-out requires CNIC verification',
    'wallet.cooldown': 'Money actions are paused for 24h after a device change',
    'wallet.success_title': 'Money sent!',
    'common.back': 'Back',
    'common.send': 'Send',
    'common.sign_out': 'Sign out',
    'common.loading': 'Loading…',
    'common.message_placeholder': 'Type a message',
    'common.tap_all': 'Tap all that apply.',
    'nav.home': 'Home',
    'nav.activity': 'Activity',
    'nav.chats': 'Chats',
    'nav.messages': 'Messages',
    'nav.chat': 'Chat',
    'nav.post_job': '+ Post',
    'security.cooldown_title': 'New device — security cooldown',
    'security.cooldown_body': 'For your safety, money actions are disabled for 24 hours after signing in on a new device. Browsing and chat work normally.',
    'onboarding.otp_title': 'Enter the 6-digit code',
    'onboarding.sms_notice': 'We will send a 6-digit code to your phone. Standard SMS rates may apply.',
    'onboarding.role_prompt': 'How will you use KAFIL?',
    'onboarding.role_subtitle': 'You can do both — choose what fits today.',
    'onboarding.role_worker': 'I want to find work',
    'onboarding.role_employer': 'I want to hire workers',
    'onboarding.specialties_title': 'What do you do?',
    'chat.welcome': 'Say salaam to get started.',
    'chat.empty': "No conversations yet. After an employer accepts your application — or you accept a worker's — a chat opens automatically.",
    'job.post_title': 'Post a job',
    'job.post_subtitle': 'Describe what you need. Be specific.',
    'job.live_immediately': 'Your job will go live immediately.',
    'job.applied': 'Applied!',
    'job.posted': 'Job posted!',
    'activity.title': 'My activity',
    'activity.applications': 'Applications',
    'activity.my_jobs': 'My jobs',
    'activity.no_applications': "You haven't applied to anything yet.",
    'activity.no_jobs': "You haven't posted any jobs yet.",
    'applicants.empty': 'No applicants yet — share this job to get workers.',
    'applicants.accept': 'Accept',
    'applicants.accepted': 'Accepted',
    'applicants.no_slot': 'No open slot',
    'job.not_accepting': 'This job is not accepting applications right now.',
    'job.stale_title': 'This job just filled',
    'job.stale_body': "This job was taken by another worker — or you've already applied. Try a similar one nearby.",
    'job.back_to_jobs': 'Back to jobs',
    'offline.apply_will_send': "You're offline. Your application is saved and will send automatically when you're back online.",
    'offline.queued': 'Queued — will send',
    'offline.banner': 'Offline — your changes are saved',
    'chat.no_messages': 'No messages yet',
  },
};

export function t(lang: Lang, key: StringKey): string {
  return dict[lang][key];
}

export const isRtl = (lang: Lang): boolean => lang === 'ps' || lang === 'ur';

export type { StringKey };
