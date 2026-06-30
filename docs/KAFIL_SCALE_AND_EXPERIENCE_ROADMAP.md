# KAFIL — Scale & Experience Roadmap (v1.2)

**Status:** Engineering roadmap · **Created:** 2026-06-30 · **Owner:** Platform
**Precedence:** Subordinate to [`KAFIL_SPEC_v1.1_ADDENDUM.md`](./KAFIL_SPEC_v1.1_ADDENDUM.md). Where this doc proposes a change to data, money, or state, the addendum's invariants (P1–P8) still win; this doc layers **experience, navigation, real-time, and scale** on top of that foundation — never around it.

---

## 0. The question this document answers

> *"Can KAFIL serve 1,000,000 people across Swat (users aged 18–60, many low-literacy), and is the app detailed, coherent, and irresistible enough — UI, UX, motion, features, error handling — to actually get there?"*

Short answer: **The foundation is genuinely 1M-capable. The experience layer is not there yet — and that gap, not the backend, is what stands between this app and a million daily-active users.** This document is the plan to close it without compromising the parts that are already correct.

It is written to be **buildable**: every section names the files, libraries, data contracts, failure modes, and acceptance criteria. No hand-waving. If a feature is described here, it is described in enough detail that an engineer can build it without guessing — and so it never ships shallow.

---

## 1. Honest readiness assessment (grounded in the actual repo, 2026-06-30)

This is a real audit of the codebase as it stands, not aspiration.

### 1.1 What is already right (and hard to retrofit — so this matters enormously)

| Capability | Evidence in repo | Why it de-risks 1M |
|---|---|---|
| **Single identity, many roles (P1)** | `packages/core/src/schemas/user.ts` (`worker/employer/shop_owner/admin/moderator/support`) | Reputation accrues to a person; you never migrate identity — the #1 catastrophic migration avoided. |
| **Double-entry money in paisa (P3)** | addendum §2.9 `wallets`/`ledger_entries`; `wallet`, `payouts`, `fund-escrow`, `webhooks/payments` routes | No floating-point money bugs; every movement balances. Auditable at any scale. |
| **Assignment state machine as data (P5)** | `packages/core/src/state-machine/index.ts` (16 states, ~20 transitions, guards) | Unhappy paths (no-show, dispute, silence→ops-review) are modeled, not improvised. |
| **Idempotency everywhere (P4)** | `IdempotencyKey` on every mutation input; `api-client` auto-attaches; `outbox` reuses keys across retries | Re-sends are safe — essential when 1M devices retry on flaky 2G/3G. |
| **Offline mutation outbox** | `packages/core/src/outbox/index.ts` (durable, optimistic, server-authoritative) | The single most important architectural fit for rural Pakistan. Rare even in funded apps. |
| **Trust & Safety first-class (P7)** | `safety.ts`, `reports`, `admin/workbench`, `disputes`, `fraud_signals` | Fraud scales with users; T&S is built-in from week one, not bolted on. |
| **Three platform pillars wired** | routes for `jobs`, `shops`, `groups`/`posts`/`comments`, `discovery/nearby` | Jobs **and** Shops **and** Community already have backend + mobile screens. This is a platform, not a job board. |
| **Distance-decay matching** | `apps/api/src/services/matching.service.ts` (specialty + exponential distance decay, 25km radius) | Hyperlocal relevance — the core value prop — already has a real ranking model. |
| **Engineering discipline** | 53 API routes, 31 test files, 36 index/unique declarations, `lib/rate-limiter.ts`, `Result` type, idempotent scheduler (`scheduler.service.ts`) | This is not a prototype. The spine scales. |

**Verdict on the foundation: ship-grade.** The things that are catastrophic to fix later are already correct.

### 1.2 What will *break* at scale (not "might" — will)

These are ordered by blast radius. Each has a fix in §3.

| # | Gap | Evidence | What breaks at scale |
|---|---|---|---|
| **B1** | **No list virtualization** | All feeds use `ScrollView`; no `FlashList` anywhere | A user with 300+ jobs/posts in feed → frame drops, then OOM crashes on the ₨15k Androids that dominate Swat. Hard failure. |
| **B2** | **No feed pagination** | `job.repository.ts` → `take: 20`, no cursor | The feed is silently truncated at 20. At 8k shops / thousands of jobs, most content is unreachable. |
| **B3** | **No real-time transport** | `ChatScreen.tsx:1` — *"v0 polls /messages every 4s; we'll swap to SSE/websockets later"* | 1M clients polling every 4s = a self-inflicted DDoS on the API. Chat & "you got hired" feel dead. |
| **B4** | **Push delivery not wired** | `devices/register` exists; no FCM/APNs/`expo-notifications` sender | Push is the #1 retention lever. Without it, install→forget. Re-engagement ≈ 0. |
| **B5** | **Hand-rolled navigation** | `App.tsx` swaps full-screen components; no `react-navigation`/`expo-router` | No deep links (your QR-in-bazaars GTM **depends** on these), no back-stack, no shared-element transitions, no notification→screen routing. |
| **B6** | **Core/server schema drift** | shop/group/post Zod schemas live in `apps/api`, not `packages/core` | The two clients can diverge from the server's shapes for the newest pillars — the exact class of bug `core` exists to prevent. |

### 1.3 What makes it feel shallow today (the experience gap)

The theme system is now genuinely strong (rich tokens, light/dark, elevation 0–4, domain hues, gradients, typographic scale — see `packages/core/src/motion/index.ts`). **But tokens are not delight.** The app is currently *clean*, not *irresistible*:

- **The rewarding moments pass silently.** Getting hired, getting paid, earning a 5-star review, hitting a referral milestone — these fire no celebration, no sound, no haptic crescendo, no mascot reaction. These are the moments people screenshot and show their friends. Right now they're a state change and a toast.
- **Nothing feels alive at rest.** No live "3 people hired near you today," no typing indicators, no presence, no gentle ambient motion. A marketplace that doesn't breathe doesn't form a habit.
- **Navigation is a cut, not a transition.** Screens replace each other instantly. No shared-element continuity (tap a card → it *becomes* the detail), no spring choreography. This is the single biggest "does it feel like a real app" tell.
- **Empty states are dead ends, not on-ramps.** "No jobs" should teach, suggest, and offer the next action — especially for a 55-year-old's first session.
- **Low-literacy is treated as a constraint, not a personality.** Voice exists but is onboarding-only. The mascot is idle decoration. The opportunity: make the accessibility need *the* delightful, tr-marked character of the app.

**This is the work.** The rest of this document specifies it in build-ready detail.

---

## 2. Design principles for an 18–60, low-literacy, 1M-user app

Every feature below is judged against these. They are the rubric; if a design fails one, it's wrong.

1. **One-thumb, one-screen, one-decision.** A 60-year-old contractor holds the phone in one hand in bright sun. Primary action is always a large, high-contrast, bottom-reachable target. Never more than one *primary* decision per screen.
2. **Icon + color + label + voice — never one alone.** §25.2 already mandates "never color alone." Extend it: every actionable concept carries a glyph, a semantic color, a short trilingual label, *and* an optional voice prompt. Redundancy is accessibility.
3. **Show state, don't describe it.** A job that's "filling up" shows 3 of 5 seats filled as filled chairs, not the sentence "3/5 slots taken." Motion and iconography over prose.
4. **Optimistic and forgiving.** Every action reflects instantly (outbox already enables this); every action is undoable for a few seconds; no action ever silently fails (errors are spoken + shown + retryable).
5. **Reward the real moments.** Celebration is proportional to meaning: a tap gets a haptic tick; getting hired gets confetti + sound + mascot + a shareable card.
6. **Alive, not noisy.** Ambient life (presence, live counts, fresh-content pulses) — but motion respects the device tier cap (§27.5) and a global "reduce motion" setting.
7. **Local and personal.** "Near you," "in Mingora," "a mason like you" — hyperlocal framing in every surface. The app should feel like it *knows the bazaar*.

---

## 3. The roadmap — phased, detailed, build-ready

Six phases. Each is independently shippable and verifiable. Phases 1–2 are the scale blockers (do first); 3–5 are the experience moat; 6 is the growth engine. Effort is in **engineer-weeks (EW)**, rough but honest.

---

### PHASE 1 — Foundations that don't retrofit (scale blockers) · ~3 EW

These unblock everything else. Do them first or build twice.

#### 1.1 Navigation: adopt `expo-router` (file-based) — *fixes B5*

**Why:** Deep links are not optional — the entire GTM (QR posters in bazaars, hotel lobbies, contractor shops; §23.4 of the addendum) routes a scanned code to a specific screen. Hand-rolled routing cannot do this, cannot restore a back-stack after a push notification, and cannot do shared-element transitions.

**Build:**
- Introduce `expo-router` with a typed route tree. Map current screens to routes:
  - `/(auth)/phone`, `/(auth)/otp`
  - `/(onboarding)/role`, `/(onboarding)/specialties`
  - `/(tabs)/home`, `/(tabs)/community`, `/(tabs)/nearby`, `/(tabs)/wallet`, `/(tabs)/activity`
  - `/job/[id]`, `/shop/[id]`, `/group/[id]`, `/chat/[conversationId]`
- Deep-link scheme: `kafil://job/<id>` and `https://kafil.pk/job/<id>` (Universal Links / App Links) so a QR or WhatsApp share opens the exact entity, or routes to install with the target preserved.
- Preserve the existing auth/onboarding state machine (`App.tsx` logic) as a **route guard** layer, not a replacement — the bootstrap → signedOut → onboarding → signedIn gating stays; only the *rendering* mechanism changes.

**Failure modes to handle:** cold-start deep link before auth hydration (queue the target, replay after `signedIn`); link to an entity the user can't see (banned/removed → friendly "this is no longer available" screen, not a crash); link to deleted job (graceful 404 screen with a "find similar near you" CTA).

**Acceptance:** scanning a QR for a specific job opens that job's detail from a cold start; Android back button traverses the real stack; a push notification deep-links into the right screen with a working back path.

#### 1.2 Bottom tab bar — the spine of "it's a platform" — *depends on 1.1*

**Why:** The three pillars (Jobs, Community, Nearby) plus Wallet and Activity exist but are reachable only by swapping modals from Home. A persistent, iconographic **bottom tab bar** is what tells a low-literacy user "there are a few big places, always here." This is the navigation backbone for daily habit.

**Build:** 5 tabs, each a large glyph + short label + domain color (using the new `domainJobs/domainShops/domainCommunity` tokens):
- 🧰 **Work** (jobs feed) — `domainJobs` green
- 🏘️ **Community** (groups/posts feed) — `domainCommunity` purple
- 📍 **Nearby** (discovery map/list) — info teal
- 💰 **Wallet** — accent ochre
- 👤 **Me** (profile/activity) — neutral
- Center FAB for the primary contextual action (Post Job if employer, "Find Work"/Apply if worker), elevated (elevation 3), with a press-spring + haptic.
- Tab transitions: cross-fade + subtle slide (Class C, native spring — never Lottie per §27.4). Active tab icon does a tiny scale-pop (Class A).
- Badge counts on tabs (unread chats, new nearby matches) — drives re-engagement.

**Acceptance:** every pillar reachable in one tap from anywhere; active tab is unmistakable by icon+color+label; badges update live (ties to Phase 4 realtime).

#### 1.3 List virtualization with `@shopify/flash-list` — *fixes B1*

**Why:** Hard crash risk on low-end devices. Non-negotiable.

**Build:** Replace `ScrollView`-of-cards and any `FlatList` in the feeds (Work, Community, Nearby, Chat list, Activity) with `FlashList`. Provide `estimatedItemSize`, stable `keyExtractor`, and typed `renderItem`. Recycle skeleton rows for the loading state (already have `Skeleton.tsx`). Keep `RefreshControl` (already added on Home).

**Acceptance:** a feed of 1,000 seeded items scrolls at 60fps on a 2GB-RAM Android profile; memory stays flat while scrolling (no linear growth).

#### 1.4 Cursor pagination + infinite scroll — *fixes B2*

**Why:** The feed currently shows ≤20 items, full stop.

**Build:**
- API: change list repositories (`job.repository.ts`, plus shops/groups/posts/discovery) to **keyset/cursor pagination** — `WHERE (created_at, id) < (:cursor)` ordered by `(featured_until desc nulls last, created_at desc, id desc)`, `LIMIT :n+1` (fetch one extra to know if there's a next page). Return `{ items, nextCursor }`. Keyset, not OFFSET — OFFSET degrades at depth and 1M rows will be deep.
- Add composite indexes matching each sort (some exist: `@@index([status, featuredUntil])` — verify coverage for the exact ordering tuple).
- Client: `FlashList` `onEndReached` → fetch next page; append; show a footer spinner; dedupe by id (outbox-style) so a re-fetch never double-inserts.

**Failure modes:** cursor pointing at a since-deleted row (keyset tolerates it — comparison still valid); feed mutated between pages (dedupe by id absorbs it); empty next page (stop, show "you're all caught up" — a *positive* end state, not a dead one).

**Acceptance:** scrolling loads page after page smoothly; no duplicates; a clean, encouraging end-of-feed state.

#### 1.5 Lift shop/group/post schemas into `packages/core` — *fixes B6*

**Build:** Author `schemas/shop.ts`, `schemas/group.ts`, `schemas/post.ts` (+ comment) in core, mirroring the addendum §2.8 tables and the shapes the API already returns. Re-export from `schemas/index.ts`. Refactor `apps/api` and `apps/mobile` to import from core. Add a vitest that asserts a sample API response parses against the core schema (contract test).

**Acceptance:** one source of truth for all three pillars; `npm run typecheck` + `npm test` green across workspaces; contract test passes.

---

### PHASE 2 — The motion & "moments" system (delight layer) · ~3 EW

This is the heart of your ask: *interactive, friendly, not boring, hard to resist.* We already have the substrate — the six-class motion taxonomy (§27.3), Lottie pipeline, haptics, sound tokens, and now a rich theme. Phase 2 *uses* it on the moments that matter.

#### 2.1 The "Moment" primitive — a reusable celebration engine

**Why:** Celebrations should be declarative and consistent, not hand-coded per screen. One component, many moments.

**Build:** `apps/mobile/src/moments/` —
- A `useMoment()` hook + `<MomentHost>` mounted once at the router root. Any screen calls `celebrate('hired')` and the host plays the choreography over the top of the current screen.
- A **moment registry** mapping a key → `{ lottie, sound, haptic, durationMs, mascotPose, shareable }`. Each respects the device-tier concurrency cap (§27.5) and the global reduce-motion setting (degrades to a static badge + haptic).
- Built-in moments (each is Class-D reward, ≤1500ms, budget-linted per §27.4):

| Moment | Trigger | Choreography |
|---|---|---|
| `hired` | worker's application accepted | confetti burst + mascot cheer + `SUCCESS_BIG` sound + success haptic + a **shareable "I got hired!" card** |
| `paid` | wallet credited / payout settled | coins-drop onto the balance, balance counts up, `success` haptic |
| `job_posted` | employer posts a job | stamp/"sent" animation + ripple out to "notifying N nearby workers" |
| `five_star` | receives a 5★ review | star fills + sparkle + badge if it crosses a reputation threshold |
| `streak`/`milestone` | Nth job, referral milestone | mascot levels-up, `STREAK` haptic |
| `first_post` | first community post | gentle confetti + "welcome to the conversation" |

**Acceptance:** calling `celebrate('hired')` plays a full multi-sensory moment on a tier-A device and degrades to a tasteful static+haptic on tier-C; never blocks interaction; never exceeds the Lottie budget.

#### 2.2 Shared-element + spring screen transitions

**Build:** With `expo-router` + `react-native-reanimated` (already a dep) + `react-native-screens`:
- **Shared element:** tapping a job/shop/post card animates the card's image+title into the detail header (the card *becomes* the page). The signature "real app" feel.
- **Screen transitions:** native spring push/pop (Class C; `springResponsive` token). Tabs cross-fade. Modals (Wallet top-up, Report sheet) spring up from the bottom with the `overlay` scrim.
- A reusable `<PressableScale>` (generalize the existing `usePressScale`) on *every* tappable surface so the whole app responds to touch — the ambient "this is alive" feel.

**Acceptance:** card→detail is visually continuous; transitions never drop frames on tier-A; reduce-motion replaces them with instant cross-fades.

#### 2.3 Living empty/loading/error states

**Build:** A `<StatefulView>` wrapper standardizing the four states for every data screen:
- **Loading:** skeletons shaped like the real content (have `Skeleton.tsx`; extend per pillar).
- **Empty:** mascot + one-line trilingual encouragement + a *primary next action* + voice prompt. ("No jobs near you yet — tap to widen your area" / "Be the first to post in Mingora Masons.")
- **Error:** spoken + shown + a big **Retry** (wired to the outbox where applicable). Never a raw error string. Distinguish offline (calm: "you're offline — we'll send this when you're back") from server error (apologetic + retry).
- **Offline-acted:** show queued items with a subtle "will send" badge (extend the existing `SyncIndicator`).

**Acceptance:** no screen ever shows a blank or a raw error; every empty state offers a forward action; offline never feels like failure.

#### 2.4 The mascot as a guide (not decoration)

**Build:** Promote `mascot_idle` into a small character system: contextual poses (idle, thinking while loading, cheering on moments, pointing at the primary action for first-time users, sleeping when offline). Drives first-run coach-marks (voice + a pointing mascot) instead of text tooltips. This is the low-literacy personality that makes the app *friendly* across the whole age range.

**Acceptance:** a first-time user is guided through their first job-apply by voice + mascot, zero reading required.

---

### PHASE 3 — Make it a habit: the unified Home feed & social fabric · ~3 EW

The pillars exist but are siloed (separate tabs). The thing that makes a 55-year-old open the app *when they don't need work* is a **blended, local, living home feed**.

#### 3.1 Unified "Today near you" feed

**Build:** A composite Work-tab feed that interleaves (ranked, not chronological):
- Jobs matching the user's specialties + location (reuse `matching.service.ts` scoring).
- Community posts from groups they're in.
- Shop updates/offers nearby.
- **Social proof cards** — "12 workers hired in Mingora today," "Hassan's Cement added new stock" — the ambient life that builds trust and habit.
- Ranking blends recency + distance-decay + relevance + a freshness boost; featured (paid) content is clearly labeled (§6.1) and capped (no more than 1-in-5, already a benchmark).

**Detail that prevents shallowness:** the feed is *typed* (each card kind has its own renderer + skeleton + tap target), supports pull-to-refresh and infinite scroll (Phase 1), shows a "new posts ↑" pill when realtime (Phase 4) delivers fresh items, and never shows the same item twice (id dedupe).

#### 3.2 Reactions, comments, presence

**Build:** Lightweight, low-literacy social: emoji reactions (👍❤️🙏 — one-tap, no typing) on posts and jobs ("5 interested"); threaded comments (already have `posts/[id]/comments`); "active now"/"last seen" presence on profiles and chat. All optimistic via the outbox; all moderated (link-stripping, the PII redaction already in `messages.body_redacted`).

#### 3.3 Profiles worth visiting

**Build:** A rich worker/employer/shop profile: verified badges (§25.2 — phone/CNIC/jobs/local, the badge tokens already exist), job history with photos, ratings, "masons like me," income record (the anti-disintermediation hook — on-platform value). This is the reputation surface that makes leaving the platform costly (§5).

**Acceptance:** the Work tab is worth opening daily even with no active job need; reactions/comments are one-tap and instant; a profile communicates trust at a glance to a non-reader.

---

### PHASE 4 — The retention engine: real-time + push · ~2.5 EW · *fixes B3, B4*

#### 4.1 Real-time transport (SSE first)

**Build:** Server-Sent Events endpoint (`/api/stream`) — simpler than websockets, survives 2G/3G reconnects, one-way is enough for the live cases. Per-user channel pushing: new message, application status change, new nearby match, reaction. Client: an `EventSource` with exponential-backoff reconnect; on reconnect, reconcile via a normal paged fetch (the SSE is a *hint to refresh*, the REST read is authoritative — same philosophy as the outbox). Replace the 4s chat poll. Plan websocket upgrade only if/when typing indicators demand bidirectional.

**Scale note:** SSE connections are cheap but not free at 1M; document the connection-per-pod math and the horizontal-scale story (sticky routing or a pub/sub fan-out like Redis) so this is a known quantity, not a surprise.

#### 4.2 Push notifications (FCM/APNs via `expo-notifications`)

**Build:** Wire delivery on top of the existing `devices/register` + `notification_deliveries` tables and `notification-triggers` (the triggers already fire in services — they just need a transport). Token lifecycle: register on cold start, dedupe by `device_fingerprint + user_id`, flip to inactive on FCM/APNs unregistered callbacks (addendum §16). **Notification types** (each deep-links via Phase 1): hired, new matching job, message, review received, payout settled, dispute update, community reply. Respect `notification_prefs` (quiet hours, per-type opt-out). Localized (ps/ur/en) + an optional voice-note push for the lowest-literacy segment.

**Acceptance:** posting a job pushes matched workers within seconds; tapping the push opens the exact job; opting out is honored; no push storm (rate-limited, batched digests for low-priority types).

---

### PHASE 5 — Polish, trust, and the "irresistible" details · ~2 EW

The compounding small things that separate a 100k app from a 1M app.

- **Onboarding that wows in 60 seconds:** voice-guided, mascot-led, three taps to a populated, local feed. First impression decides retention.
- **Instant search** across jobs/shops/workers/groups with debounced queries, recent searches, and voice search (speak a trade → results).
- **"Reduce motion" + "Large text" + high-contrast** accessibility settings (the 60-year-old segment). Already have the token plumbing.
- **Skeleton-to-content choreography:** content fades/slides in as it replaces skeletons (Class B), never a hard pop.
- **Haptic vocabulary:** a consistent, documented haptic for each interaction class (already have the tokens; apply them everywhere via `<PressableScale>`).
- **Shareable artifacts:** "I got hired" cards, shop QR codes, profile share links — every share is a growth loop (ties to Phase 6).
- **Sound design (optional, off by default in public):** subtle, culturally-appropriate cues for moments.

---

### PHASE 6 — Growth loops (so 1M is reachable, not just serveable) · ~2 EW

Serving 1M and *reaching* 1M are different problems. The product must grow itself.

- **Referrals with anti-farming** (already built — `referrals`/`referrals/claim`): surface it as a first-class, celebrated moment (Phase 2 `milestone`).
- **QR everywhere** (GTM §23.4): every shop, job, and profile has a shareable QR/deep link. A poster in a bazaar is a zero-literacy install funnel.
- **WhatsApp share** of jobs/shops (WhatsApp is the incumbent §72) — meet users where they are; each share deep-links back.
- **Invite-a-contractor / build-a-crew** (the `crews` tables exist in §2): network effects on the supply side.
- **Activation metrics instrumented** (P8 — every important action already emits a typed analytics event): measure time-to-first-apply, D1/D7/D30 retention, feed-scroll-depth, moment-share-rate. Instrument before optimizing.

---

## 4. Cross-cutting: error handling & resilience at 1M (so nothing feels shallow under stress)

Detail here is what makes the app feel solid when things go wrong — which, at 1M on 2G/3G, is constantly.

- **Every mutation: optimistic + outbox + idempotent + undoable.** Already architected (`outbox`, `IdempotencyKey`). Extend the *UI contract*: a 3-second undo on destructive/important actions before the outbox flushes.
- **Every error is classified, never raw.** Offline (calm, queued) vs. transient 5xx (auto-retry with backoff — already in `api-client`) vs. client 4xx (explain + fix path) vs. conflict 409 (server-authoritative resolution — outbox already models `conflict`). Each maps to a specific, spoken, iconographic UI — never a stack trace, never a silent failure.
- **React error boundaries** per route (currently none) → a friendly "something went wrong, tap to reload" with the mascot, plus a crash report. One screen crashing must never white-screen the app.
- **Degrade, don't disable:** no recordings → text+icons; no haptics → silent; tier-C device → static frames; offline → queued. The app is always usable at *some* fidelity (the philosophy already in voice/motion — generalize it everywhere).
- **Backpressure & quotas:** rate-limit at the edge (have `rate-limiter.ts`), batch low-priority pushes into digests, cap SSE fan-out, paginate everything. Document the per-pod connection math.
- **Observability (P8):** typed analytics + delivery/bounce metrics for push + SSE-connection health. You cannot operate 1M blind.

---

## 5. Scale architecture notes (the boring stuff that decides if 1M works)

- **Database:** keyset pagination (§3 P1.4), composite indexes per sort path (36 declared — audit coverage as feeds grow), connection pooling (PgBouncer in front of Postgres at this scale), read replicas for feeds/discovery (writes stay on primary; money/state on primary always). PostGIS for `discovery/nearby` (the distance math in `matching.service.ts` should be index-backed, not in-app, as candidate sets grow).
- **Caching:** Redis for hot feeds, nearby candidate sets, and SSE pub/sub fan-out. Cache is a read accelerator only — money & state are never cache-authoritative (P3).
- **Media:** the `media/upload` storage provider must be CDN-fronted; images resized/transcoded server-side (a 12MP phone photo over 2G is unusable raw). OCR-for-PII on chat images (§5/§10) runs async, off the request path.
- **Jobs/scheduler:** the idempotent `scheduler.service.ts` graduates from in-process loop to a real cron worker (node-cron → k8s CronJob) with advisory locks (already designed, §24/C3).
- **Stateless API pods** behind a load balancer; sticky routing only for SSE (or move SSE fan-out to Redis pub/sub to keep pods stateless).

---

## 6. Sequencing, effort, and the recommended path

| Phase | Theme | Effort | Ship gate |
|---|---|---|---|
| **1** | Foundations (nav, tabs, virtualization, pagination, core schemas) | ~3 EW | Scale blockers gone; deep links work |
| **2** | Motion & moments (delight) | ~3 EW | "Irresistible" is visible & felt |
| **3** | Unified home feed & social fabric (habit) | ~3 EW | Daily-open without job need |
| **4** | Real-time + push (retention) | ~2.5 EW | Re-engagement engine live |
| **5** | Polish & accessibility | ~2 EW | 18–60 inclusivity proven |
| **6** | Growth loops | ~2 EW | Self-propagating install funnel |

**Total: ~15.5 engineer-weeks** to go from "strong foundation" to "1M-ready, irresistible." Phases are independently shippable — value lands continuously, not at the end.

**Recommended immediate next step:** **Phase 1.1 + 1.3 together** (expo-router + FlashList). They're the two changes that (a) unblock everything else and (b) are pure-risk-reduction with no design debate. Then Phase 2.1 (the Moment engine) so the "hard to resist" quality becomes tangible fast.

---

## 7. What this document deliberately does **not** promise

Honesty so scope stays real:
- **Video sharing is out of current scope.** The spec models text + images (`posts.images`, `messages.body` text-only with PII redaction). Video is a genuine new feature (storage, transcoding, moderation, 2G-bandwidth reality) and must be specced separately before it's built. It is **not** assumed anywhere above.
- **No feature here weakens P1–P8.** Every addition rides on the existing identity/money/state/idempotency/T&S spine. If a delight feature ever conflicts with a money or safety invariant, the invariant wins.
- **Estimates are directional.** EW figures are planning aids, not commitments; each phase should be re-scoped at its start against the then-current codebase.

---

*Append changes as the build progresses. This doc is the experience-and-scale companion to the v1.1 engineering addendum — read them together.*
