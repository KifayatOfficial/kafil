# KAFIL — Master Document Index

**Last updated:** 2026-06-29
**Purpose:** The single entry point to the KAFIL document set. Read this first. It tells you which document is authoritative for what, in what order to read, and where the documents disagree (and who wins).

---

## THE GOLDEN RULE

> There are two "generations" of documents:
> - **v1.0 (business generation):** the original spec, execution map, audit, and quick reference. Excellent on vision, market, business model, legal, and go-to-market.
> - **v1.1 (engineering generation):** the addendum. Authoritative on **data model, application logic, money, security, and build order.**
>
> **Wherever a v1.0 document conflicts with v1.1, v1.1 wins.** The v1.0 docs now carry banners and inline corrections pointing here. This is by design — v1.1 fixes issues (disintermediation, an un-buildable schema, a missing state machine, absent fraud/money subsystems) that would otherwise be discovered in production.

---

## THE DOCUMENTS

| # | File | Generation | Authoritative for | Status |
|---|------|-----------|-------------------|--------|
| 1 | `KAFIL_COMPLETE_SPECIFICATION.md` | v1.0 | Vision, market research, business model rationale, GTM | Business truth; engineering details superseded by #5 |
| 2 | `KAFIL_PROJECT_EXECUTION_MAP.md` | v1.0 | Dependency thinking, risk timeline, metrics dashboard | ERD + week plan + "Next.js 14" superseded by #5 |
| 3 | `KAFIL_AUDIT_AND_GAP_ANALYSIS.md` | v1.0 | Pakistan legal/tax, regional GTM, KPI taxonomy, research | Payment flow (Gap 1) + finances (Gap 5) overturned by #5 |
| 4 | `KAFIL_QUICK_REFERENCE.md` | v1.0 | Navigation aid for the business docs | Now points here; "3 docs" → 5 |
| 5 | **`KAFIL_SPEC_v1.1_ADDENDUM.md`** | **v1.1** | **Data model, state machines, money, security, build order** | **Engineering source of truth** |
| 0 | `KAFIL_DOCS_INDEX.md` (this file) | — | Hierarchy, precedence, reading order | — |

---

## WHAT v1.1 CHANGED (the short version)

The v1.0 set was assessed as "100% ready to build." It was **business-ready, not engineering-ready.** v1.1 supplies what was missing or wrong:

1. **Anti-disintermediation (§5)** — the v1.0 payment flow (swap phones → cash off-platform → trust them to remit commission) leaks the primary revenue stream to ~0%. Fixed with masked contact, on-platform value, and escrow-netted commission.
2. **A buildable data model (§2–§3)** — v1.0's schema references an `employers` table it never defines, splits one person into worker/employer identities, and has FK-less ratings. Replaced with single-identity + roles, slots for multi-worker jobs, and FK-backed double-blind reviews.
3. **A job state machine (§4)** — v1.0 listed statuses but no transitions; the unhappy paths (no-show, cancel, expiry, dispute, rating deadlock) are where a marketplace's real logic lives.
4. **Money done right (§6)** — double-entry ledger, escrow, refunds, idempotent payments — none of which v1.0 had.
5. **Trust & Safety + fraud threat model (§9–§10)** — v1.0 assumed good actors; real PK marketplaces face advance-fee fraud, Sybils, and review rings from week one.
6. **Realistic finances (§21)** — v1.0's $195–206k / 92%-margin / Month-3-breakeven assumed 100% commission collection. Corrected to a leakage-adjusted ~$20–45k Year 1 with escrow as the durable engine.
7. Plus: reputation (§7), matching (§8), WhatsApp reality (§11), localization/RTL/low-literacy (§12), offline sync (§13), concurrency (§14), liquidity engine (§15), observability (§16), compliance gates (§17), ops back-office (§18), a prioritized backlog (§19), and a corrected build roadmap (§22).
8. **Mobile-first client architecture (§23)** — the first client is **native Android + iOS (Expo/React Native)** plus a responsive Next.js web app, because Swat's low-literacy users can't type URLs (entry = app icon / QR / WhatsApp-shared APK). This overturns the v1.0 docs' PWA-first / "mobile apps = Phase 3" assumption and makes distribution (APK hosting, QR, deep links) a first-class infra concern.
9. **Self-audit (§24) + mainstream-app gaps (§25)** — v1.1 audited itself: 25 real bugs and flow faults discovered in the addendum (SIM-swap identity hijacking, ledger drift, slot-unique blocking re-hire, "auto-complete in employer's favor" enabling non-payment fraud, redaction regex bypasses, push-token leaks, etc.) — all fixed in §24. §25 then enumerates ~80 mainstream-app features needed for 1M-user scale (voice onboarding, recurring jobs, crews, counter-offers, tips, suggested rates, status page, forced-upgrade gate, etc.) that v1.1 §1–§23 didn't have.

---

## READING ORDER

### If you're building it (engineer)
1. **`KAFIL_SPEC_v1.1_ADDENDUM.md`** — entire thing. This is what you build from.
2. `KAFIL_COMPLETE_SPECIFICATION.md` — for product intent and feature meaning behind the schema.
3. `KAFIL_AUDIT_AND_GAP_ANALYSIS.md` — for the Pakistan legal/compliance framework (still valid) and research findings.
4. `KAFIL_PROJECT_EXECUTION_MAP.md` — for the metrics dashboard and risk timeline (skip the obsolete ERD/week-plan; use v1.1 §22).

### If you're pitching/investing (business)
1. `KAFIL_COMPLETE_SPECIFICATION.md` — Executive Summary + Market.
2. `KAFIL_SPEC_v1.1_ADDENDUM.md` **§21** — the *honest* financial picture (do not pitch the v1.0 numbers).
3. `KAFIL_AUDIT_AND_GAP_ANALYSIS.md` — legal/regional/GTM.

### If you just want orientation
- This index, then `KAFIL_QUICK_REFERENCE.md`.

---

## AUTHORITY MAP (who governs each topic)

| Topic | Authoritative document |
|---|---|
| What KAFIL is / why / market size | #1 Complete Specification |
| Database schema, entities, relationships | **#5 v1.1 §2–§3** |
| Job/application lifecycle & transitions | **#5 v1.1 §4** |
| Payments, commission, escrow, ledger | **#5 v1.1 §5–§6** |
| Reputation & reviews | **#5 v1.1 §7** |
| Matching / ranking | **#5 v1.1 §8** |
| Fraud, trust & safety, moderation | **#5 v1.1 §9–§10** |
| Notifications (WhatsApp/SMS) | **#5 v1.1 §11** |
| Localization, RTL, accessibility | **#5 v1.1 §12** |
| Offline / sync / concurrency | **#5 v1.1 §13–§14** |
| Cold-start / liquidity | **#5 v1.1 §15** |
| Client architecture (mobile/web) & distribution | **#5 v1.1 §23** |
| Known bugs / races / flow faults in v1.1 itself | **#5 v1.1 §24** (superseded where §26 conflicts) |
| Mainstream-app feature gaps (1M-user readiness) | **#5 v1.1 §25** |
| Second-pass audit (meta-review + categories §24 missed) | **#5 v1.1 §26** |
| Motion / animation system (Lottielab, mascot, sound, haptics) | **#5 v1.1 §27** |
| Commission + monetization rates (provisional, tunable via `settings`) | **#5 v1.1 §6.1** |
| Escrow release rule (merged B4 + M4) | **#5 v1.1 §6.2** |
| Schema deltas from §24/§25/§26 (canonical, additive to §2) | **#5 v1.1 §2.13** |
| Seasonality + ops-load budget + recovery-path literacy fix | **#5 v1.1 §28** |
| What to build first (build order) | **#5 v1.1 §19, §22** |
| Financial projections | **#5 v1.1 §21** (v1.0 figures are an optimistic ceiling) |
| Pakistan legal / tax / data protection | #3 Audit Gap 4 (+ gates concretized in v1.1 §17) |
| Regional go-to-market | #3 Audit Gap 3 |
| KPI taxonomy / metrics | #3 Audit Gap 6 + **#5 v1.1 §16, §21.3** |
| Risk timeline | #2 Execution Map Part 4 |

---

## MAINTENANCE RULE (keep this set consistent going forward)

When KAFIL evolves:
1. **Engineering changes** (schema, logic, money, security, build order) → edit `KAFIL_SPEC_v1.1_ADDENDUM.md` and add a dated line to its **Change Log**. Do *not* edit the v1.0 docs' bodies for engineering changes; they are historical.
2. **Business changes** (market, GTM, legal) → edit the relevant v1.0 doc, and if it touches anything v1.1 governs, add a reconciliation row to v1.1 §21.1.
3. **Always update this index's tables** when a document is added, retired, or changes authority.
4. If a v1.0 statement becomes actively misleading, add an inline `🛑 CORRECTION` callout pointing to the governing v1.1 section (as already done for Audit Gap 1/Gap 5 and the Execution Map ERD).

---

**End of index.**
