# Design Overhaul — Phased Plan

Status: **proposal, no code written yet.** Six improvements, grouped into phases
that build on each other. Effort is rough dev-time; risk is "how much existing
behaviour could this break."

---

## Guiding principles

1. **One shell, three page archetypes.** Every screen is a *List*, a *Detail*, or
   an *Edit/Create* page. Each archetype gets one wrapper component so layout,
   header, back button, and spacing are decided in exactly one place.
2. **Back button and logo are shell, not page concerns.** Pages should never
   hand-roll either again.
3. **Perceived speed = preload + cache.** Show known data instantly, revalidate
   in the background. Never block a screen on a fetch we could have prefetched.

---

## Recommended order

| Phase | Items | Why first |
|------|-------|-----------|
| **1 — Shell foundation** | #1 back button, #2 logo move, #3 page archetypes | Everything else renders *inside* these. Cheap, high visual payoff, low logic risk. |
| **2 — Quick access** | #6 current-event button | Small, self-contained, depends only on shell being stable. |
| **3 — Speed** | #4 data preloading | Independent of UI; can land in parallel with Phase 2. |
| **4 — Big merge** | #5 Matches + Pairing | Largest, riskiest, touches the two biggest files. Do it last, on a stable base. |

---

## Phase 1 — Shell foundation

### #1 — Standardized back button

**Goal:** one back affordance, same position (top-left), on every non-root screen.

**Current state**
- `AppHeader` already has a `back={{ label, href?, onClick?, subtitle? }}` prop
  rendered by `BackChevron` (`src/components/AppHeader.tsx:52`, `:123`). This is
  the canonical mechanism — it's just not used everywhere.
- Hand-rolled exceptions to migrate:
  - `src/app/notifications/page.tsx:122` — `router.back()` button
  - `src/app/players/new/page.tsx:149` — `← Back` `<Link>`
  - `src/app/leagues/[id]/page.tsx:1939` — bespoke `editBackLink()` sticky buttons
  - List pages use `<h2>` headers with no back button (correct — they're roots).

**DECISION (locked): hybrid — hierarchical "up" button + native swipe-back.**
- The in-header button is **hierarchical**: every screen declares its logical
  *parent* `href`. Same position (top-left), truthful label (`← Events`),
  deterministic regardless of how the user arrived (notification, deep link,
  current-event FAB). This is the *guaranteed* affordance — always present on
  every platform.
- Native **history swipe-back** is a free OS bonus we never depend on and never
  break. Availability by distribution form:

  | Form | Parent button | Native swipe/back |
  |---|---|---|
  | iOS Safari tab | ✅ | ✅ |
  | iOS home-screen PWA (standalone) | ✅ | ❌ (Apple limitation) |
  | iOS App Store (wrapped, e.g. Capacitor) | ✅ | ✅ via WKWebView `allowsBackForwardNavigationGestures` |
  | Android Chrome / PWA | ✅ | ✅ |
  | Android Play Store (wrapped / TWA) | ✅ | ✅ (route system back → web history) |

- **Store builds = wrapped apps** (same web code in a native WebView shell, not a
  rewrite). Swipe-back is recoverable on *both* stores via one wrapper config
  flag, so the parent button built now survives the move to stores unchanged.

**Approach**
1. Treat `AppHeader`'s `back` slot as the *only* sanctioned back UI. Lock the
   position (top-left, fixed header) and styling there.
2. Back-target convention: **`href`-based hierarchical "up"**, never
   `router.back()` (history-dependent, breaks on deep-link / notification /
   first-page-in-session). Each page declares where "up" goes.
3. Migrate the 3 hand-rolled spots to `AppHeader.back`.
4. Add a lint-style guard (grep in CI or a code-review checklist) for `← Back`
   string literals and `router.back()` in `page.tsx` files to prevent regressions.

**Files:** `AppHeader.tsx` (lock styling), 3 page migrations.
**Effort:** S (½ day). **Risk:** Low.

---

### #2 — Move FriendlyBall logo below the bottom nav

**Goal:** free the top-left for the back button; logo becomes a persistent footer
brand mark.

**Current state**
- Logo renders top-left in all three header variants:
  `AppHeader.tsx:440` (light), `:541` (hero), `:712` (hero-sub), via
  `src/components/Logo.tsx`.
- Layout shell: `src/app/layout.tsx:52-53` (`<main>` then `<BottomNav/>`).

**Approach**
1. Remove the three in-header `<Logo>` instances.
2. Add a footer logo *below* `<BottomNav>` in `layout.tsx`. Because `BottomNav`
   is `position: fixed`, the footer logo must also sit in the fixed bottom stack
   (a thin strip under the nav) **or** scroll at the end of `<main>`. Given the
   fixed nav, recommend a **small static strip rendered at the bottom of page
   content** (scrolls with the page, sits above the safe-area padding) rather
   than a second fixed element competing with the nav for the safe-area inset.
3. Re-test header height sync — `useHeaderHeightSync` (`AppHeader.tsx:16`) pushes
   header height into `--header-height` and `#main-content` padding-top. Removing
   the logo shrinks the header; verify sticky tab bars still align.

**DECISION (locked): fixed strip under the bottom nav.**

**DONE.** Removed `<Logo>` from all 3 `AppHeader` variants (replaced with a
zero-width spacer so `space-between` keeps actions right-aligned) and from the
global light header path. Added a subtle brand strip inside `BottomNav`'s fixed
`<nav>`, below the tab row and above the safe-area inset (`border-t`, brand-green
Logo size 15). Bumped `#main-content` bottom padding `5rem → 6.75rem` so content
clears the taller bottom stack.

**Files:** `AppHeader.tsx` (×3 spacers + drop Logo import), `BottomNav.tsx`
(strip), `layout.tsx` (padding).
**Effort:** S. **Risk:** Low–Med (header-height re-measure, safe-area interplay).
**Note for Phase 2 FAB:** the current-event button must clear this taller bottom
stack (nav + logo strip + safe-area).

---

### #3 — Separate UX for List / Detail / Edit pages

**Goal:** three wrapper components so the ~3 archetypes stop being hand-rolled.
Today every page opens with a bespoke `<div className="space-y-4">` plus its own
header pattern, and list-item padding drifts (`p-3` vs `p-4`) between Events,
Clubs, Players, Leagues.

**Proposed primitives** (`src/components/page/`)

| Component | Wraps | Provides |
|-----------|-------|----------|
| `ListPage` | list screens | root `<h2>` title + optional action button (+ Event/+ Club…), search/filter slot, `space-y-2` list container |
| `ListItem` | list rows | one `frameClass` card, single padding (`p-4`), optional `href`/`onClick`, chevron |
| `DetailPage` | entity screens | `AppHeader` hero wiring (title/meta/status/back), section spacing |
| `EditPage` | create/edit screens | `AppHeader.back`, page title, `FormCard` form container, sticky Save/Cancel (only when dirty — matches existing edit-UX rule) |
| `FormCard` | form sections | `frameClass p-4 space-y-3` |

These compose on the existing `Card`/`frameClass` (`src/components/Card.tsx`) — no
visual reinvention, just consolidation.

**Migration targets**
- List: `events/page.tsx`, `clubs/page.tsx`, `players/page.tsx`, `leagues/page.tsx`, `matches/page.tsx`
- Detail: `events/[id]/page.tsx`, `clubs/[id]/page.tsx`, `profile/page.tsx`, `leagues/[id]/page.tsx`
- Edit: `events/new`, `players/new`, `leagues/new`, inline forms in `clubs/page.tsx` & `profile/page.tsx`

**Approach:** build the primitives first; migrate **one page per archetype** as
a proof, confirm, then roll out the rest. Don't big-bang all 13 pages.

**IN PROGRESS:**
- BUILT `src/components/page/` — `ListPage` / `List` / `ListItem` (list archetype),
  `EditPage` / `FormCard` (edit archetype), barrel `index.ts`. All compose on the
  existing `Card`/`frameClass`; standard outline action button + loading/empty
  states baked into `ListPage`.
- PROOF MIGRATIONS DONE: `app/leagues/page.tsx` (→ ListPage/List/ListItem) and
  `app/players/new/page.tsx` (→ EditPage/FormCard). tsc + eslint clean.
- `DetailPage` BUILT — DECISION: detail pages use the **bold green AppHeader hero
  (Style B)**, consistent with event pages. `DetailPage` renders the hero and
  encapsulates the chrome the global `Header` normally owns (bell poll + avatar);
  pages adopting it are added to `Header.tsx`'s hidden-route list to avoid a
  double header.
- DETAIL PROOF DONE: `app/leagues/[id]/page.tsx` → `DetailPage`. League name +
  season + status now live in the green hero; the tap-the-header-to-edit gesture
  is replaced by an explicit "Edit details" pen button (AppHeader hero isn't
  clickable). Both the loading/preview view and the loaded view use the hero.
  `Header.tsx` now hides the global header on `/leagues/[id]` (not `/leagues/new`).
  - VERIFY ON DEVICE: league *edit sub-sections* (editSection states) lose the
    global top bar (they keep their `editBackLink` sticky) — confirm that reads OK.
- `profile` is a POOR fit for the back+title hero (its identity is a centered
  avatar/name card) — recommend keeping it custom rather than forcing the green
  hero. `clubs/[id]` needs a decision on where the cover photo sits under the hero.

**Remaining rollout (after sign-off on the two proofs):**
- List: `events`, `clubs`, `players`, `matches` (Events' multi-row filter stays as
  `filters` slot content).
- Edit: `events/new`, `leagues/new`, inline forms in `clubs` & `profile`.
- Detail: build `DetailPage`/`DetailHero` once header model is decided, then
  `clubs/[id]`, `leagues/[id]`, `profile`, `events/[id]`.

**Files:** new `src/components/page/*`; incremental page migrations.
**Effort:** L (primitives S, done; migration sweep is the bulk, pending).
**Risk:** Med — mitigated by incremental rollout + filter UIs staying as slots.

---

## Phase 2 — Current-event quick button (#6)

**Goal:** floating button (bottom-right) that jumps straight back to "the current
event" from anywhere. **Detection = auto + manual pin; manual wins** (per your choice).

**Current state**
- `BottomNav` already computes a "best" active event with a priority heuristic
  (`BottomNav.tsx:48-90`: setup-by-me 110 → live 100 → ended-<4h 50 → next-upcoming 30)
  and shows a Setup/Live badge tab (`:126`). This is most of the *auto* half.

**Approach**
1. **Manual pin (wins):** add "Set as current" on the event detail page; persist
   the pinned event id. Storage options:
   - `localStorage` (instant, device-local) — recommended for v1, zero backend.
   - user record field (syncs across devices) — follow-up if wanted.
2. **Resolver:** `currentEvent = pinnedEvent ?? autoBest`, reusing the existing
   `BottomNav` heuristic. Extract that heuristic into a shared hook
   (`useCurrentEvent`) so the nav badge and the new button agree.
3. **Button:** floating action button bottom-right, above the safe-area inset and
   clear of the bottom nav. Hidden when already on that event's page (mirror the
   existing `isOnActiveEvent` guard, `BottomNav.tsx:99`) and on auth pages.
4. Pinned state clears when the event completes (or via an explicit "unset").

**Files:** new `useCurrentEvent` hook, FAB component, `layout.tsx` mount,
`events/[id]/page.tsx` "Set as current" control, refactor `BottomNav` onto the hook.
**Effort:** M. **Risk:** Low–Med (FAB vs nav z-index/safe-area; pin lifecycle).
**Decision needed:** pin storage = `localStorage` (v1) vs user-record (synced).

---

## Phase 3 — Faster key data (#4)

**Goal:** key data appears instantly; full event data is ready before the user
taps into a sub-section.

**Current state**
- Events list: direct `fetch` + `sessionStorage` cache (`events/page.tsx:85-93,165`)
  + 30s `usePollingRefresh`.
- Event detail: SWR `useEvent` (`src/lib/swr.ts:8`) with `revalidateOnFocus`,
  plus a `sessionStorage` "preview" for instant hero before full load
  (`events/page.tsx:519`).
- Gaps: no prefetch of current/next events; list polling refetches *all* events
  every 30s; no shared cache for players/clubs.

**Approach**
1. **Standardize on SWR** for lists too (drop the bespoke `fetch`+sessionStorage
   in favour of SWR's cache + `revalidateOnFocus`), so list and detail share one
   caching model. Keep a tiny localStorage seed for cold-start instant paint.
2. **Prefetch the working set:** on app load / events-list mount, warm the SWR
   cache for *last 10 + current + next 10* events (key data only). Then opening
   any of them is instant.
3. **Eager full-load on open:** confirm `/api/events/{id}` already returns
   everything the detail tabs need in one response (the exploration says yes —
   players, matches, classes, helpers). If any tab still lazy-fetches (e.g. the
   all-players admin picker, `events/[id]/page.tsx:2335`), prefetch it on event
   open so the tab is warm.
4. **Smarter polling:** poll only the *active* event frequently; back off the
   full list to a longer interval or revalidate-on-focus only.

**Files:** `src/lib/swr.ts` (list hooks + prefetch helpers), `events/page.tsx`,
`events/[id]/page.tsx`, `src/lib/hooks.ts` (polling).
**Effort:** M. **Risk:** Med — changing the list's data layer can introduce
stale/flash bugs; roll out behind careful testing of back-nav and live updates.

---

## Phase 4 — Merge Matches + Pairing (#5)

**Goal:** one combined screen: view the rounds/matches list **and** edit pairing
settings **and** generate the next round (auto or manual) — no separate fullscreen
configurator.

**Current state (two places)**
- `src/app/events/[id]/pairing/page.tsx` (~2,400 lines): full config — class
  selector, settings form, live preview (`runPreview` :344), pair locks (:706),
  skill levels (:1028), manual match creator (:756), match list/editor.
  `handleGenerateRound` :437, `handleGenerate` (next match) :466.
- `events/[id]/page.tsx` "Rounds"/"Pairing" tabs: mostly view/score; the in-event
  "Pairing" tab just links out to the configurator (`renderPairing` ~:2711).
- Generation API already supports everything needed:
  `POST /api/events/[id]/pairing/generate-round` (preview / commit / individual).

**Approach**
1. **Combined tab** in `events/[id]` replacing the split: top = collapsible
   "Pairing settings" (mode, teams, gender, skill windows) with a **gear/edit**
   to expand; below = the rounds/matches list; a primary **"Generate next round"**
   button with an **auto / manual** toggle, plus "Generate next match" for
   continuous play.
2. **Reuse, don't rewrite:** lift the configurator's logic (settings save,
   preview, generate, locks, skill, manual) into shared hooks/components so both
   the merged tab and any retained deep-config view call the same code. The
   pairing page's heavy solver-preview UI can stay reachable as an "Advanced"
   expansion rather than a separate route.
3. **Shared data context:** the merged tab uses the already-loaded `useEvent`
   data — no second fetch (today the configurator re-fetches on mount).
4. **Redirect** `/events/[id]/pairing` → the merged tab (keep the URL working for
   existing links/bookmarks).

**Files:** `events/[id]/page.tsx` (new combined tab), extract shared modules from
`pairing/page.tsx`, route redirect.
**Effort:** XL. **Risk:** High — two largest files, live-scoring + solver paths,
continuous-play court logic. Needs its own plan + thorough manual verification
(generate round, manual match, locks, skill edit, score entry) before merge.
**Recommendation:** scope this as a separate planning pass once Phases 1–3 land.

---

## Open decisions (blocking nothing, but cheaper to settle now)

1. ~~Back-target rule~~ — **DECIDED: hybrid, `href`-based hierarchical up + native swipe.** (Phase 1)
2. ~~Footer logo~~ — **DECIDED & DONE: fixed strip under the nav.** (Phase 1)
3. **Detail page header model** — do club/league/profile detail pages keep the global light header (in-body hero), or move to `AppHeader` hero (and get hidden from the global `Header`)? Blocks building `DetailPage`. (Phase 1 · #3)
3. Current-event pin storage: **`localStorage` v1** vs synced user-record? (Phase 2)
4. Phase 4 merge: confirm "Advanced" deep-config stays reachable vs fully folded in.
