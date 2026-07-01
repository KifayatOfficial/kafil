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
  | 'error.title'
  | 'error.offline_title'
  | 'error.offline_body'
  | 'common.retry'
  | 'common.reload'
  | 'error.crashed_title'
  | 'error.crashed_body'
  | 'coach.first_apply'
  | 'empty.no_jobs'
  | 'empty.jobs_hint'
  | 'empty.tip_radius'
  | 'empty.tip_time'
  | 'empty.tip_notify'
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
  | 'nav.you'
  | 'nav.activity'
  | 'nav.chats'
  | 'nav.messages'
  | 'nav.chat'
  | 'nav.post_job'
  | 'community.title'
  | 'community.none'
  | 'community.create'
  | 'community.create_title'
  | 'community.name_ph'
  | 'community.desc_ph'
  | 'community.members'
  | 'community.join'
  | 'community.joined'
  | 'community.leave'
  | 'community.posts_empty'
  | 'community.write_post'
  | 'community.post_cta'
  | 'community.join_to_post'
  | 'community.comments'
  | 'community.write_comment'
  | 'community.pinned'
  | 'shops.title'
  | 'shops.none'
  | 'shops.create'
  | 'shops.create_title'
  | 'shops.name_ph'
  | 'shops.desc_ph'
  | 'shops.category_ph'
  | 'shops.reviews'
  | 'shops.no_reviews'
  | 'shops.write_review'
  | 'shops.your_rating'
  | 'shops.submit_review'
  | 'shops.review_done'
  | 'nearby.title'
  | 'nearby.none'
  | 'nearby.all'
  | 'nearby.jobs'
  | 'nearby.shops'
  | 'nearby.groups'
  | 'nearby.km_away'
  | 'nearby.no_location'
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
  | 'sync.offline'
  | 'sync.syncing'
  | 'sync.synced'
  | 'sync.failed'
  | 'rate.market'
  | 'rate.below_market'
  | 'badge.phone_verified'
  | 'badge.cnic_verified'
  | 'badge.experienced'
  | 'badge.online_now'
  | 'badge.active_today'
  | 'badge.active_week'
  | 'badge.pro'
  | 'pro.title'
  | 'pro.subtitle'
  | 'pro.cta'
  | 'pro.active'
  | 'pro.success'
  | 'chat.no_messages'
  | 'chat.sending'
  | 'chat.send_failed'
  | 'voice.replay'
  | 'referral.title'
  | 'referral.subtitle'
  | 'referral.your_code'
  | 'referral.share'
  | 'referral.share_message'
  | 'referral.my_referrals'
  | 'referral.none'
  | 'referral.earned'
  | 'referral.status_pending'
  | 'referral.status_qualified'
  | 'referral.status_rejected'
  | 'referral.have_code'
  | 'referral.enter_code'
  | 'referral.claim'
  | 'referral.claimed'
  | 'nav.referrals'
  | 'featured.badge'
  | 'featured.boost'
  | 'featured.active'
  | 'featured.boosted'
  | 'featured.insufficient'
  | 'wallet.topup'
  | 'wallet.topup_amount'
  | 'wallet.topup_cta'
  | 'wallet.topup_success'
  | 'wallet.topup_pending';

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
    'error.title': 'یوه ستونزه پیښه شوه',
    'error.offline_title': 'تاسو آف‌لاین یاست',
    'error.offline_body': 'کله چې بیرته راشئ، موږ به یې بیا هڅه وکړو',
    'common.retry': 'بیا هڅه وکړئ',
    'common.reload': 'بیا پیل کړئ',
    'error.crashed_title': 'یوه ستونزه راپیدا شوه',
    'error.crashed_body': 'دا برخه بنده شوه. بیا یې پیل کړئ.',
    'coach.first_apply': 'یوه دنده ووهئ چې یې وګورئ او غوښتنه وکړئ',
    'empty.no_jobs': 'دلته اوس کار نشته',
    'empty.jobs_hint': 'موږ به تاسو خبر کړو کله چې نوی کار راشي.',
    'empty.tip_radius': 'خپله ساحه پراخه کړئ',
    'empty.tip_time': 'ماښام بیا وګورئ',
    'empty.tip_notify': 'کله چې کار راشي خبر به شئ',
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
    'nav.you': 'زه',
    'nav.activity': 'فعالیت',
    'nav.chats': 'خبرې',
    'nav.messages': 'پیغامونه',
    'nav.chat': 'خبرې',
    'nav.post_job': '+ کار',
    'community.title': 'ټولنه',
    'community.none': 'تر اوسه هیڅ ډله نشته — لومړۍ جوړه کړئ!',
    'community.create': '+ نوې ډله',
    'community.create_title': 'ډله جوړه کړئ',
    'community.name_ph': 'د ډلې نوم (لکه مینګوره معماران)',
    'community.desc_ph': 'دا ډله د څه لپاره ده؟',
    'community.members': 'غړي',
    'community.join': 'ګډون',
    'community.joined': 'غړی یاست',
    'community.leave': 'وتل',
    'community.posts_empty': 'تر اوسه هیڅ پوسټ نشته — لومړی ولیکئ.',
    'community.write_post': 'یو څه ولیکئ…',
    'community.post_cta': 'خپور کړئ',
    'community.join_to_post': 'د لیکلو لپاره ګډون وکړئ',
    'community.comments': 'تبصرې',
    'community.write_comment': 'تبصره ولیکئ…',
    'community.pinned': '📌 پین شوی',
    'shops.title': 'پلورنځي',
    'shops.none': 'تر اوسه هیڅ پلورنځی نشته.',
    'shops.create': '+ پلورنځی',
    'shops.create_title': 'پلورنځی جوړ کړئ',
    'shops.name_ph': 'د پلورنځي نوم',
    'shops.desc_ph': 'تاسو څه پلورئ؟',
    'shops.category_ph': 'ډله (لکه سیمنټ)',
    'shops.reviews': 'بیاکتنې',
    'shops.no_reviews': 'تر اوسه هیڅ بیاکتنه نشته.',
    'shops.write_review': 'بیاکتنه ولیکئ',
    'shops.your_rating': 'ستاسو درجه',
    'shops.submit_review': 'ولیږئ',
    'shops.review_done': 'مننه — بیاکتنه مو خوندي شوه!',
    'nearby.title': 'نږدې',
    'nearby.none': 'ستاسو نږدې هیڅ شی ونه موندل شو.',
    'nearby.all': 'ټول',
    'nearby.jobs': 'کارونه',
    'nearby.shops': 'پلورنځي',
    'nearby.groups': 'ډلې',
    'nearby.km_away': 'کیلومتره لرې',
    'nearby.no_location': 'لومړی خپل ځای وټاکئ',
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
    'sync.offline': 'آفلاین',
    'sync.syncing': 'همغږي کیږي',
    'sync.synced': 'خوندي شو',
    'sync.failed': 'ونه لېږل شول — ټک ووهئ',
    'rate.market': 'د دې کار بازاري نرخ',
    'rate.below_market': 'دا نرخ د بازار څخه ټیټ دی — ښه کارګران به یې ونه مني',
    'badge.phone_verified': '✓ فون تصدیق',
    'badge.cnic_verified': '✓ شناخت تصدیق',
    'badge.experienced': 'تجربه‌کار',
    'badge.online_now': 'اوس آنلاین',
    'badge.active_today': 'نن فعال',
    'badge.active_week': 'دا اونۍ فعال',
    'badge.pro': '★ پرو',
    'pro.title': 'پرو کارګر شئ',
    'pro.subtitle': 'د پرو نښان، په لټون کې لوړ ځای، او لوی پروفایل — کارفرمایان پرو کارګران ژر مني.',
    'pro.cta': 'پرو شئ',
    'pro.active': 'تاسو پرو یاست',
    'pro.success': 'ته اوس پرو یې!',
    'chat.no_messages': 'تر اوسه پیغام نشته',
    'chat.sending': 'لېږل کیږي…',
    'chat.send_failed': 'ونه لېږل شو — بیا هڅه وکړئ',
    'voice.replay': 'بیا واورئ',
    'referral.title': 'ملګري راوبلئ',
    'referral.subtitle': 'خپل کوډ شریک کړئ. کله چې ستاسو ملګری خپل لومړی کار بشپړ کړي، تاسو انعام ترلاسه کوئ.',
    'referral.your_code': 'ستاسو کوډ',
    'referral.share': 'کوډ شریک کړئ',
    'referral.share_message': 'په کافل کې راسره یوځای شئ! زما کوډ وکاروئ: ',
    'referral.my_referrals': 'زما بلنې',
    'referral.none': 'تر اوسه مو هیڅوک نه دي راوبللي.',
    'referral.earned': 'گټل شوي',
    'referral.status_pending': 'انتظار کې',
    'referral.status_qualified': 'انعام ترلاسه شو',
    'referral.status_rejected': 'رد شو',
    'referral.have_code': 'کوډ لرئ؟',
    'referral.enter_code': 'د ملګري کوډ ولیکئ',
    'referral.claim': 'وکاروئ',
    'referral.claimed': 'کوډ ومنل شو!',
    'nav.referrals': 'بلنې',
    'featured.badge': '⭐ مخکښ',
    'featured.boost': 'سر ته پورته کړئ',
    'featured.active': 'دا کار اوس مخکښ دی',
    'featured.boosted': 'ستاسو کار سر ته پورته شو!',
    'featured.insufficient': 'بیلانس کافي نه دی — لومړی بټوه ډکه کړئ',
    'wallet.topup': 'بټوه ډکول',
    'wallet.topup_amount': 'د ډکولو اندازه (روپۍ)',
    'wallet.topup_cta': 'پیسې اضافه کړئ',
    'wallet.topup_success': 'بټوه ډکه شوه!',
    'wallet.topup_pending': 'تادیه پروسس کیږي…',
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
    'error.title': 'کچھ غلط ہو گیا',
    'error.offline_title': 'آپ آف لائن ہیں',
    'error.offline_body': 'جب آپ واپس آئیں گے تو ہم دوبارہ کوشش کریں گے',
    'common.retry': 'دوبارہ کوشش کریں',
    'common.reload': 'دوبارہ شروع کریں',
    'error.crashed_title': 'ایک مسئلہ پیش آگیا',
    'error.crashed_body': 'یہ حصہ رک گیا۔ دوبارہ شروع کریں۔',
    'coach.first_apply': 'دیکھنے اور درخواست دینے کے لیے کسی کام پر ٹیپ کریں',
    'empty.no_jobs': 'اس وقت کوئی کام نہیں',
    'empty.jobs_hint': 'نیا کام آنے پر ہم آپ کو بتائیں گے۔',
    'empty.tip_radius': 'اپنا علاقہ بڑھائیں',
    'empty.tip_time': 'شام کو دوبارہ دیکھیں',
    'empty.tip_notify': 'کام آنے پر اطلاع پائیں',
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
    'nav.you': 'آپ',
    'nav.activity': 'سرگرمی',
    'nav.chats': 'چیٹس',
    'nav.messages': 'پیغامات',
    'nav.chat': 'چیٹ',
    'nav.post_job': '+ کام',
    'community.title': 'کمیونٹی',
    'community.none': 'ابھی کوئی گروپ نہیں — پہلا بنائیں!',
    'community.create': '+ نیا گروپ',
    'community.create_title': 'گروپ بنائیں',
    'community.name_ph': 'گروپ کا نام (مثلاً مینگورہ معمار)',
    'community.desc_ph': 'یہ گروپ کس لیے ہے؟',
    'community.members': 'ارکان',
    'community.join': 'شامل ہوں',
    'community.joined': 'رکن ہیں',
    'community.leave': 'چھوڑیں',
    'community.posts_empty': 'ابھی کوئی پوسٹ نہیں — پہلی لکھیں۔',
    'community.write_post': 'کچھ لکھیں…',
    'community.post_cta': 'پوسٹ کریں',
    'community.join_to_post': 'لکھنے کے لیے شامل ہوں',
    'community.comments': 'تبصرے',
    'community.write_comment': 'تبصرہ لکھیں…',
    'community.pinned': '📌 پن شدہ',
    'shops.title': 'دکانیں',
    'shops.none': 'ابھی کوئی دکان نہیں۔',
    'shops.create': '+ دکان',
    'shops.create_title': 'دکان بنائیں',
    'shops.name_ph': 'دکان کا نام',
    'shops.desc_ph': 'آپ کیا بیچتے ہیں؟',
    'shops.category_ph': 'قسم (مثلاً سیمنٹ)',
    'shops.reviews': 'جائزے',
    'shops.no_reviews': 'ابھی کوئی جائزہ نہیں۔',
    'shops.write_review': 'جائزہ لکھیں',
    'shops.your_rating': 'آپ کی درجہ بندی',
    'shops.submit_review': 'بھیجیں',
    'shops.review_done': 'شکریہ — آپ کا جائزہ محفوظ ہو گیا!',
    'nearby.title': 'قریب',
    'nearby.none': 'آپ کے قریب کچھ نہیں ملا۔',
    'nearby.all': 'سب',
    'nearby.jobs': 'کام',
    'nearby.shops': 'دکانیں',
    'nearby.groups': 'گروپ',
    'nearby.km_away': 'کلومیٹر دور',
    'nearby.no_location': 'پہلے اپنا مقام منتخب کریں',
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
    'sync.offline': 'آف لائن',
    'sync.syncing': 'سنک ہو رہا ہے',
    'sync.synced': 'محفوظ',
    'sync.failed': 'نہیں بھیجا گیا — ٹیپ کریں',
    'rate.market': 'اس کام کا بازاری ریٹ',
    'rate.below_market': 'یہ ریٹ بازار سے کم ہے — اچھے کارکن شاید درخواست نہ دیں',
    'badge.phone_verified': '✓ فون تصدیق شدہ',
    'badge.cnic_verified': '✓ شناختی کارڈ تصدیق شدہ',
    'badge.experienced': 'تجربہ کار',
    'badge.online_now': 'ابھی آن لائن',
    'badge.active_today': 'آج فعال',
    'badge.active_week': 'اس ہفتے فعال',
    'badge.pro': '★ پرو',
    'pro.title': 'پرو کارکن بنیں',
    'pro.subtitle': 'پرو بیج، تلاش میں اوپر، اور بڑا پروفائل — آجر پرو کارکنوں کو جلدی قبول کرتے ہیں۔',
    'pro.cta': 'پرو بنیں',
    'pro.active': 'آپ پرو ہیں',
    'pro.success': 'آپ اب پرو ہیں!',
    'chat.no_messages': 'ابھی تک کوئی پیغام نہیں',
    'chat.sending': 'بھیجا جا رہا ہے…',
    'chat.send_failed': 'نہیں بھیجا گیا — دوبارہ کوشش کریں',
    'voice.replay': 'دوبارہ سنیں',
    'referral.title': 'دوستوں کو بلائیں',
    'referral.subtitle': 'اپنا کوڈ شیئر کریں۔ جب آپ کا دوست پہلا کام مکمل کرے، آپ کو انعام ملے گا۔',
    'referral.your_code': 'آپ کا کوڈ',
    'referral.share': 'کوڈ شیئر کریں',
    'referral.share_message': 'کافل پر میرے ساتھ شامل ہوں! میرا کوڈ استعمال کریں: ',
    'referral.my_referrals': 'میری دعوتیں',
    'referral.none': 'ابھی تک آپ نے کسی کو نہیں بلایا۔',
    'referral.earned': 'کمایا',
    'referral.status_pending': 'زیرِ التواء',
    'referral.status_qualified': 'انعام مل گیا',
    'referral.status_rejected': 'مسترد',
    'referral.have_code': 'کوڈ ہے؟',
    'referral.enter_code': 'دوست کا کوڈ درج کریں',
    'referral.claim': 'استعمال کریں',
    'referral.claimed': 'کوڈ قبول ہو گیا!',
    'nav.referrals': 'دعوتیں',
    'featured.badge': '⭐ نمایاں',
    'featured.boost': 'سب سے اوپر لے جائیں',
    'featured.active': 'یہ کام ابھی نمایاں ہے',
    'featured.boosted': 'آپ کا کام اوپر آ گیا!',
    'featured.insufficient': 'بیلنس کافی نہیں — پہلے والیٹ ٹاپ اپ کریں',
    'wallet.topup': 'والیٹ ٹاپ اپ',
    'wallet.topup_amount': 'ٹاپ اپ رقم (روپے)',
    'wallet.topup_cta': 'پیسے شامل کریں',
    'wallet.topup_success': 'والیٹ ٹاپ اپ ہو گیا!',
    'wallet.topup_pending': 'ادائیگی پروسیس ہو رہی ہے…',
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
    'error.title': 'Something went wrong',
    'error.offline_title': 'You’re offline',
    'error.offline_body': 'We’ll try again when you’re back',
    'common.retry': 'Try again',
    'common.reload': 'Reload',
    'error.crashed_title': 'Something broke',
    'error.crashed_body': 'This part stopped working. Tap to reload.',
    'coach.first_apply': 'Tap a job to see it and apply',
    'empty.no_jobs': 'No jobs in your area yet',
    'empty.jobs_hint': "We'll let you know the moment a new job is posted.",
    'empty.tip_radius': 'Widen your area',
    'empty.tip_time': 'Check back this evening',
    'empty.tip_notify': "Get notified when work appears",
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
    'nav.you': 'You',
    'nav.activity': 'Activity',
    'nav.chats': 'Chats',
    'nav.messages': 'Messages',
    'nav.chat': 'Chat',
    'nav.post_job': '+ Post',
    'community.title': 'Community',
    'community.none': 'No groups yet — create the first one!',
    'community.create': '+ New group',
    'community.create_title': 'Create a group',
    'community.name_ph': 'Group name (e.g. Mingora Masons)',
    'community.desc_ph': "What's this group for?",
    'community.members': 'members',
    'community.join': 'Join',
    'community.joined': 'Member',
    'community.leave': 'Leave',
    'community.posts_empty': 'No posts yet — write the first one.',
    'community.write_post': 'Write something…',
    'community.post_cta': 'Post',
    'community.join_to_post': 'Join to post',
    'community.comments': 'Comments',
    'community.write_comment': 'Write a comment…',
    'community.pinned': '📌 Pinned',
    'shops.title': 'Shops',
    'shops.none': 'No shops listed yet.',
    'shops.create': '+ Shop',
    'shops.create_title': 'List a shop',
    'shops.name_ph': 'Shop name',
    'shops.desc_ph': 'What do you sell?',
    'shops.category_ph': 'Category (e.g. cement)',
    'shops.reviews': 'Reviews',
    'shops.no_reviews': 'No reviews yet.',
    'shops.write_review': 'Write a review',
    'shops.your_rating': 'Your rating',
    'shops.submit_review': 'Submit',
    'shops.review_done': 'Thanks — your review is saved!',
    'nearby.title': 'Nearby',
    'nearby.none': 'Nothing found near you.',
    'nearby.all': 'All',
    'nearby.jobs': 'Jobs',
    'nearby.shops': 'Shops',
    'nearby.groups': 'Groups',
    'nearby.km_away': 'km away',
    'nearby.no_location': 'Set your location first',
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
    'sync.offline': 'Offline',
    'sync.syncing': 'Syncing',
    'sync.synced': 'Saved',
    'sync.failed': "Didn't send — tap",
    'rate.market': 'Market rate for this work',
    'rate.below_market': 'This rate is below market — quality workers may not apply',
    'badge.phone_verified': '✓ Phone verified',
    'badge.cnic_verified': '✓ CNIC verified',
    'badge.experienced': 'Experienced',
    'badge.online_now': 'Online now',
    'badge.active_today': 'Active today',
    'badge.active_week': 'Active this week',
    'badge.pro': '★ Pro',
    'pro.title': 'Become a Pro worker',
    'pro.subtitle': 'Pro badge, higher in search, and a bigger profile — employers accept Pro workers faster.',
    'pro.cta': 'Go Pro',
    'pro.active': "You're Pro",
    'pro.success': "You're now Pro!",
    'chat.no_messages': 'No messages yet',
    'chat.sending': 'Sending…',
    'chat.send_failed': "Didn't send — tap to retry",
    'voice.replay': 'Play again',
    'referral.title': 'Invite friends',
    'referral.subtitle': "Share your code. When your friend completes their first job, you earn a reward.",
    'referral.your_code': 'Your code',
    'referral.share': 'Share code',
    'referral.share_message': 'Join me on KAFIL! Use my code: ',
    'referral.my_referrals': 'My invites',
    'referral.none': "You haven't invited anyone yet.",
    'referral.earned': 'earned',
    'referral.status_pending': 'Pending',
    'referral.status_qualified': 'Reward earned',
    'referral.status_rejected': 'Rejected',
    'referral.have_code': 'Have a code?',
    'referral.enter_code': "Enter a friend's code",
    'referral.claim': 'Use code',
    'referral.claimed': 'Code accepted!',
    'nav.referrals': 'Invites',
    'featured.badge': '⭐ Featured',
    'featured.boost': 'Boost to top',
    'featured.active': 'This job is featured',
    'featured.boosted': 'Your job is boosted to the top!',
    'featured.insufficient': 'Not enough balance — top up your wallet first',
    'wallet.topup': 'Top up',
    'wallet.topup_amount': 'Top-up amount (PKR)',
    'wallet.topup_cta': 'Add money',
    'wallet.topup_success': 'Wallet topped up!',
    'wallet.topup_pending': 'Processing payment…',
  },
};

export function t(lang: Lang, key: StringKey): string {
  return dict[lang][key];
}

export const isRtl = (lang: Lang): boolean => lang === 'ps' || lang === 'ur';

export type { StringKey };
