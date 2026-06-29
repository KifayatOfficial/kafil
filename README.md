# KAFIL

[![ci](https://github.com/KifayatOfficial/kafil/actions/workflows/ci.yml/badge.svg)](https://github.com/KifayatOfficial/kafil/actions/workflows/ci.yml)

Hyperlocal labor & community marketplace for Swat, Northern Pakistan.

> **Read the spec first.** This codebase is built strictly from the v1.1 engineering addendum.
> Start at **[`docs/README.md`](docs/README.md)** → then **[`docs/KAFIL_DOCS_INDEX.md`](docs/KAFIL_DOCS_INDEX.md)** for the canonical hierarchy.
> Where any older doc conflicts with **[`docs/KAFIL_SPEC_v1.1_ADDENDUM.md`](docs/KAFIL_SPEC_v1.1_ADDENDUM.md)**, **v1.1 wins**.

## Repo layout

```
kafil/
├─ packages/
│  └─ core/           Shared: Zod schemas, types, API client, motion tokens, i18n
├─ apps/
│  ├─ api/            Next.js API (route → service → repository per §1/P2)
│  ├─ web/            Next.js desktop/admin
│  └─ mobile/         Expo (Android-first per §26/M21, iOS via EAS later)
└─ infra/             docker-compose (Postgres+PostGIS), distribution config
```

## Prerequisites

- Node **22 LTS** (`.nvmrc` pins this; `nvm use` or `mise use`)
- Docker (for local Postgres)
- A real Android device (Expo Go) or the Expo web preview for quick mobile checks

## Quick start

```bash
# 1. Install
npm install

# 2. Start Postgres locally (PostGIS-enabled)
npm run db:up

# 3. Apply schema + seed
npm run db:migrate
npm run db:seed

# 4. Run the API
npm run dev:api          # http://localhost:3001

# 5. Run web (separate terminal)
npm run dev:web          # http://localhost:3000

# 6. Run mobile (separate terminal — scan QR with Expo Go)
npm run dev:mobile
```

## Architecture invariants (do not violate)

These come from `KAFIL_SPEC_v1.1_ADDENDUM.md §1` (the principles `P1–P8`) — every PR is reviewed against them:

- **P1.** One identity (`users`), many roles. Never split worker/employer identities.
- **P2.** Layered, swappable. Routes never touch the DB. Services never know about HTTP. Repositories are the only thing that knows the database exists. External services behind provider interfaces.
- **P3.** Money + state changes are events. Every transition writes to `events` and (if money) to balanced `ledger_entries` in the same transaction.
- **P4.** Idempotency on every mutating endpoint, every state transition, every webhook.
- **P5.** Optimistic locking (`version` column) on contended rows. Partial unique indexes for slots/applications per §24/A3/A5.
- **P6.** PII (phone, location) is platform-asset. Contact is masked until value captured. Geo is fuzzed in lists.
- **P7.** Trust & Safety is first-class. Reports/fraud signals/bans/appeals are MVP, not later.
- **P8.** Every important action emits a typed analytics event.

## State machine (§4.3)

Authoritative source: `KAFIL_SPEC_v1.1_ADDENDUM.md §4.3`. The canonical service implementation lives in `apps/api/src/services/assignment.service.ts`. The `awaiting_ops_review` evidence-fallback rule (§26/M1) replaces the deprecated §24/A6 directional fallback — do not implement the old form.

## Motion (§27)

Six-class taxonomy enforced via `packages/core/motion`. CI lints Lottielab assets for size/expressions/masks per §27.4. Never use Lottie for screen transitions (always native springs).

## Voice prompts (§25.1)

Low-literacy onboarding uses **recorded Pashto/Urdu narration, never TTS**. The catalog lives in `packages/core/voice` (`VoiceCatalog`); the mobile player is `apps/mobile/src/voice` (`VoiceProvider` / `useVoicePrompt` / `VoicePromptButton`). Each onboarding screen autoplays its prompt on enter and shows a 🔊 replay button.

**Adding recordings is config, not code:**

1. Record one `.m4a` (AAC) file per prompt key per voiced language (`ps`, `ur`). Keys are the `VoiceKey` union in `packages/core/src/voice/index.ts`; the narration should match the screen's i18n string.
2. Upload to your audio CDN at the path `<base>/<lang>/<key>.m4a` — e.g. `https://cdn.kafil.pk/voice/ps/onboarding.welcome.m4a`.
3. Set `extra.voiceBaseUrl` in `apps/mobile/app.json` to the CDN base. Until it's set (dev / restricted envs), every prompt resolves to `null` and the player + button degrade to a silent no-op — text and icons still carry the screen.

While recordings are partial, pass a `VoiceCatalog({ baseUrl, available: [...] })` allowlist so unrecorded keys stay silent instead of 404-ing.
