# KAFIL — Specification & Engineering Docs

This folder is the **source of truth** for KAFIL's design and engineering invariants. The code in this repository is implemented strictly against it.

## Quick map

| File | Purpose | Authority |
|---|---|---|
| **[KAFIL_DOCS_INDEX.md](KAFIL_DOCS_INDEX.md)** | Master index — read first. Hierarchy, precedence, reading order. | — |
| **[KAFIL_SPEC_v1.1_ADDENDUM.md](KAFIL_SPEC_v1.1_ADDENDUM.md)** | The engineering source of truth (§1–§28). **Authoritative on data model, state machines, money, security, and build order.** | **Wins on conflict** |
| [KAFIL_COMPLETE_SPECIFICATION.md](KAFIL_COMPLETE_SPECIFICATION.md) | v1.0 business spec — market, features, GTM. | Business intent; engineering details superseded |
| [KAFIL_PROJECT_EXECUTION_MAP.md](KAFIL_PROJECT_EXECUTION_MAP.md) | v1.0 timeline & dependency map. | Risk timeline + metrics dashboard kept; ERD + week plan superseded by v1.1 §2 / §22 |
| [KAFIL_AUDIT_AND_GAP_ANALYSIS.md](KAFIL_AUDIT_AND_GAP_ANALYSIS.md) | v1.0 gap analysis (legal, finance, regional GTM). | Legal/regional kept; payment flow + finances overturned by v1.1 §5 / §21 |
| [KAFIL_QUICK_REFERENCE.md](KAFIL_QUICK_REFERENCE.md) | v1.0 navigation aid. | Now points back here |

## The golden rule

**v1.1 wins.** Wherever a v1.0 doc and v1.1 conflict, follow v1.1. The v1.0 docs carry `⚠️ READ FIRST` banners and `🛑 CORRECTION` callouts at the dangerous spots so a reader can't miss it.

## Maintenance rule (kept in sync with the repo)

This is the same rule v1.1 §0 declares; restating here so it's visible to repo contributors:

1. **Engineering changes** (schema, logic, money, security, build order) → edit `KAFIL_SPEC_v1.1_ADDENDUM.md` and add a dated line to its **CHANGE LOG** at the bottom. Do NOT edit the v1.0 docs' bodies for engineering changes; they are historical.
2. **Business changes** (market, GTM, legal) → edit the relevant v1.0 doc. If it touches anything v1.1 governs, also add a reconciliation row to v1.1 §21.1.
3. **Always update `KAFIL_DOCS_INDEX.md`'s tables** when a document is added, retired, or changes authority.
4. If a v1.0 statement becomes actively misleading, add an inline `🛑 CORRECTION` callout pointing to the governing v1.1 section.
5. **Code must follow §1's P1–P8 architectural invariants** — they are enforced by code review and by the integration tests in `apps/api/src/services/__tests__/`.

## Reading order

- **Engineers building KAFIL:** v1.1 addendum in full, then code in `apps/`. Skim the v1.0 docs for context only.
- **Investors / advisors:** Executive Summary in `KAFIL_COMPLETE_SPECIFICATION.md`, then **v1.1 §21** for the honest financial picture (the v1.0 figures are an optimistic ceiling that depends on an overturned commission model — do not pitch them).
- **Newcomers:** `KAFIL_DOCS_INDEX.md` first.

## Pull-request gates

Any PR that:
- changes the schema → updates `KAFIL_SPEC_v1.1_ADDENDUM.md` §2/§2.13 + adds a migration + a test.
- changes a state-machine transition → updates §4.3 (in-place amendments only; don't drop old rows) + the data in `packages/core/src/state-machine/index.ts` + a test.
- changes money/ledger semantics → updates §6 + writes paired ledger entries via the `LedgerTransaction` helper + adds a test.
- introduces a new external provider → adds a provider interface (P2) + a console/stub adapter for dev.

CI enforces typecheck + the 5 invariant tests against real Postgres. Add more tests freely; never remove the existing ones without replacing them.
