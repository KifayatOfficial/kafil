# KAFIL Design Research — Amazon Portals → what transfers to KAFIL

**Date:** 2026-06-30
**Purpose:** Research Amazon's production design systems ("Portals") and extract what
genuinely improves KAFIL, separating the *systems* (transferable) from the *look*
(mostly NOT transferable, and why).

---

## 1. What Amazon's "Portals" actually are

Amazon builds its internal + AWS UIs on two flagship design systems:

- **Cloudscape** (`cloudscape.aws.dev`) — the design system for the **AWS Management
  Console** and internal AWS builder tools. Dense, table-heavy, side-nav + split-panel +
  help-panel layouts. Optimized for **expert users on desktop** doing high-information
  tasks (create/manage cloud resources).
- **Meridian** (`meridian.a2z.com`) — the design system for Amazon **retail / devices /
  consumer** surfaces. Broader, more brand-expressive, multi-platform (web + native).

Both are **token-driven component libraries** with rigorous motion, accessibility, and
writing guidelines. The engineering quality is the thing worth stealing — not the visual
density.

### The honest caveat (drives every recommendation below)
> Cloudscape is built for **expert users, desktop, high information density, fast
> networks**. KAFIL's users are **low-literacy, mobile-only, 2G/3G, low-end Android, in
> Swat**. Copying Cloudscape's *look* (tables, split panels, dense forms, desktop chrome)
> would make KAFIL **worse**. We copy its **systems and discipline**, not its surface.

---

## 2. Cloudscape Motion System (the highest-value finding)

Cloudscape codifies motion into a tiny, reusable contract. This is directly portable to
KAFIL's §27 motion layer.

### Easing curves (only three)
| Curve | cubic-bezier | Character | Use |
|---|---|---|---|
| **A — Responsive** | `(0.0, 0.0, 0.0, 1.0)` | responsive yet smooth | dropdowns, popovers, most entrances |
| **B — Sticky** | `(1.0, 0.0, 0.83, 1.0)` | element "sticks" to a state | hover-out on charts |
| **C — Expressive** | `(0.84, 0.0, 0.16, 1.0)` | draws attention expressively | links, flashbar |

### Durations (only three)
| Token | Value | Use |
|---|---|---|
| responsive | **115ms** | quick/responsive (dropdown, popover reveal) |
| expressive | **165ms** | more expressive (error shake, link hover) |
| complex | **250ms** | more attention / complexity (flashbar slide) |

### Transform patterns (only four)
- **Scale** — scale content into view to focus attention (modals scale up).
- **Fade** — smooth show/hide (modals, selects, date pickers).
- **Slide** — spatial/structural clue; elements slide **from the direction of their
  trigger** (side nav, help panel, flashbar from top).
- **Shake** — error attention (form field shakes 5px each side, curve A, 165ms).

### Canonical use-cases (copy these mappings)
- **Dropdown / menu appear:** fade + scale, curve A, 115ms.
- **Modal appear:** fade + scale-up, curve A, 115ms.
- **Panel (side/help) appear:** slide from trigger, curve A, 115ms.
- **Flashbar / toast:** slide from top, curve C, 250ms.
- **Error state:** fade-in + 5px shake, curve A, 165ms.
- **Link/interactive hover:** color + underline, curve C, 165ms.
- **Loading:** continuous spinner / progress bar.

### Accessibility (mandatory, we were missing this)
- **Respect `prefers-reduced-motion`** — disable non-essential animation when the OS
  requests it. (RN: `AccessibilityInfo.isReduceMotionEnabled()` + `reduceMotionChanged`.)
- Never flash > 3×/second (seizure / vestibular safety).
- UI must be perceivable **without** motion — motion is never the only signal.
- **Disable motion in tests** (deterministic snapshots/timing).

---

## 3. Design-token architecture (validates + refines KAFIL's approach)

Cloudscape tokens use **CTI naming: Category → Type → Item → (Sub-item) → State**
(e.g. `color-background-button-primary-default`, `motion-duration-complex`).

- Tokens are **key/value** so values change at system/runtime level (theming, light/dark)
  without call sites changing — exactly what KAFIL's `makeStyles(t => …)` + theme already
  does. **Validation: KAFIL's token+theme direction is correct.**
- Tokens ship as **JSON** (Design Tokens Community Group format) → run through
  **style-dictionary** to emit platform outputs (Sass/JS for web, XML for Android, Swift
  for iOS). KAFIL's `packages/core/motion` already is the cross-platform contract; the
  refinement is to name things CTI-style and keep the *token* stable while values move.
- `motion-*` tokens carry a `{ default, disabled }` shape — the `disabled` value is how
  reduced-motion is honored at the token level (duration → 0ms).

**Refinements for KAFIL:**
1. Add the three **named easing curves** (A/B/C) to `motion` tokens (we had ad-hoc
   `easeStandard`/`easeEmphasized`; align to the proven set + keep spring configs for RN).
2. Give durations the Cloudscape triad meaning (responsive/expressive/complex) alongside
   our xs/sm/md scale.
3. Reduced-motion → a single source of truth that collapses durations to 0 and swaps
   Lottie for a static frame (ties into our existing DeviceTier tier_c path).

---

## 4. Loading & refreshing patterns (Cloudscape)

- **Manual refresh** (user-triggered button, keep data visible during refresh, show a
  "last updated" timestamp) vs **automatic refresh** (interval). Choose by use-case.
- **Skeleton screens over spinners** for first load — "spinners feel broken on 2G"
  (Cloudscape says this for desktop; it's *doubly* true for our users). KAFIL already has
  `SkeletonList` — keep leaning on it.
- On refresh **failure/partial-failure**, use a **status indicator + popover** with a
  reason and a retry action — don't silently fail. (Maps to KAFIL's SyncIndicator +
  per-item retry we already built.)
- Announce refresh updates via an **ARIA live region** (RN: `accessibilityLiveRegion`).

**Validation:** KAFIL's pull-to-refresh + skeleton + SyncIndicator + tap-to-retry bubbles
already follow this. Gap: add "last updated" affordance where lists auto-refresh (chat),
and `accessibilityLiveRegion` on the sync pill.

---

## 5. Writing / content guidelines (Cloudscape) — selectively applicable

- Sentence case; present tense; active voice; address the user as "you".
- Device-independent verbs ("choose"/"select", not "click"/"tap").
- No "please/thank you", no ellipsis/ampersand/etc. in UI copy.
- **KAFIL divergence:** Cloudscape bans exclamation points and mandates terse desktop
  copy. KAFIL *deliberately* uses warmth + reward language ("You're hired!", mascot) for a
  low-literacy, trust-building consumer audience. Keep KAFIL's warmer voice; adopt the
  *consistency* discipline (one term per concept, sentence case, active voice).

---

## 6. What we will NOT copy (and why)

| Cloudscape / enterprise pattern | Why it's wrong for KAFIL |
|---|---|
| Data tables / dense grids | Low-literacy users can't parse tables; mobile has no width. Use cards. |
| Side-nav + split-panel + help-panel chrome | Desktop multi-pane layout; KAFIL is one-hand mobile. Use a bottom tab bar. |
| Form-dense create flows | Our flows are icon-first, voice-guided, minimal-typing. |
| "No exclamation points / terse" tone | KAFIL needs warmth + celebration for trust + habit. |
| Information density | KAFIL optimizes for *clarity per screen*, not *data per screen*. |

---

## 7. Concrete KAFIL action plan (derived from this research)

1. **Motion foundation upgrade (systems):** add named easing curves (A/B/C) + the
   responsive/expressive/complex durations to `packages/core/motion`; add a
   reduced-motion source of truth on mobile (`AccessibilityInfo`) that collapses
   durations to 0 and forces static Lottie frames; add reusable **entrance** helpers
   (fade+scale, slide-from-edge, staggered list) built on Reanimated so screens get
   consistent, smooth appearance animations. *(This is "more animation, smoother",
   done as a system, not per-screen hacks.)*
2. **The "Portal" — a real Home hub + bottom tab nav:** replace the crowded 8-button
   action row with a bottom tab bar (Home / Community / Shops / Nearby / Wallet) + a Home
   dashboard that surfaces each pillar with animated, staggered cards. This is the
   "detailed Portal" the app is missing and the flagged nav-crowding fix.
3. **Loading/refresh polish:** `accessibilityLiveRegion` on SyncIndicator; "last updated"
   on the chat poll; keep skeletons everywhere.
4. **Token hygiene:** migrate ad-hoc easing names to the CTI-aligned set; document the
   motion contract in one place so PRs reference it (mirrors Cloudscape's motion page).

**Sequencing:** (1) motion foundation first (everything else animates on top of it), then
(2) the Portal/bottom-nav, then (3) loading polish + token hygiene.

---

## Sources (Amazon internal, Midway)
- Cloudscape Motion — `cloudscape.aws.dev/foundation/visual-foundation/motion/`
- Cloudscape Design Tokens — `cloudscape.aws.dev/foundation/visual-foundation/design-tokens/`
- Cloudscape Loading & refreshing — `cloudscape.aws.dev/patterns/general/loading-and-refreshing/`
- Meridian — `meridian.a2z.com` (retail/consumer system; consulted for brand-expressive motion)
