# PickleJ — App Store, Monetization & Scaling Strategy

## 1. Current Setup

| Component | Service | Tier | Limit |
|---|---|---|---|
| Hosting | Vercel | Free/Hobby | ~1,000-2,000 daily users |
| Database | Neon PostgreSQL | Free | 0.5 GB, ~500-1,000 active users |
| File storage | Vercel Blob | Free | 500 MB (~500 users with photos) |
| App type | PWA | — | Installable from browser |

**Current capacity:** 200-500 registered users, 50-100 concurrent. Comfortable for a club or small regional league.

**To scale to 1,000+ users:** Neon Pro ($19/mo) + Vercel Pro ($20/mo). No code changes needed.

**Database indexes added** (2026-04-12): Match(eventId, status), MatchPlayer(playerId), EventPlayer(playerId), EventClass(eventId), Event(clubId, status, date), ClubMember(playerId).

---

## 2. App Store Listing

### Approach: Capacitor (wrapped PWA)

Capacitor wraps the existing Next.js app in a native shell. No rewrite needed.

| | Capacitor | Native (Swift + Kotlin) |
|---|---|---|
| Codebase | 1 (current Next.js) | 2 separate codebases |
| Dev effort | ~1 week | 3-6 months rebuild |
| Updates | Deploy to Vercel, instant | App Store review each time |
| Performance | 95% native feel | 100% native feel |
| Native APIs | Via plugins (haptics, camera) | Full access |
| Maintenance | 1 codebase | 3 codebases |

### Costs

| | Cost | Frequency |
|---|---|---|
| Apple Developer Program | $99 | Per year |
| Google Play Developer | $25 | One-time, lifetime |
| Custom domain (e.g. picklej.app) | ~$12 | Per year |

### Native feel assessment

**Feels native (already):**
- Home screen icon, splash screen, no browser bar
- Touch gestures, full screen, status bar styling
- Bottom nav, safe-area insets

**Small gaps:**
- No haptic feedback (fixable with Capacitor plugins)
- No pull-to-refresh (needs implementation)
- Page transitions feel like web, not native slide animations
- Camera/photo picker uses browser UI

**Reality:** For a utility app like PickleJ (scoring, events, standings), a wrapped PWA is indistinguishable from native for 90% of users. Android is actually better than iOS for WebView performance.

### Apple review risk

Apple sometimes rejects thin PWA wrappers. Mitigation:
- Add push notifications before submitting
- Add some offline caching
- Ensure the app has enough functionality to justify a native listing

### When to go truly native

Only if you need: complex animations/gestures, heavy offline-first, Bluetooth (court sensors), or AR features. None of these apply to PickleJ currently.

Migration to native later is possible:
- API routes stay (native apps just call them)
- Database stays (Neon)
- Frontend: full rewrite (SwiftUI + Jetpack Compose)
- Auth: swap NextAuth for token-based
- Timeline: 3-4 months per platform with experienced mobile dev

---

## 3. Self-Service Features Needed

### Password reset via email
- Already have `/reset/[token]` endpoint
- Need email provider: **Resend** ($0 for 100 emails/day)
- ~2 hours of work to integrate

### Push notifications
- Web Push API + service worker
- "Your match is starting", "Score confirmed"
- Makes the app feel alive

---

## 4. Monetization Strategy

### Recommended model: Payment Platform (Stripe Connect)

PickleJ becomes the payment platform. Clubs/organizers charge players through PickleJ. PickleJ takes a cut.

### How it works

1. Club admin enables payments → Stripe onboarding (KYC, bank details, ~5 min)
2. Organizer sets price per event/league
3. Player signs up → pays through PickleJ
4. Stripe auto-splits: platform fee to PickleJ, rest to club's bank
5. Players pay via card / Apple Pay / Google Pay

### Revenue examples (8% platform fee)

| What | Player pays | PickleJ gets | Club gets |
|---|---|---|---|
| Weekly event | €5 | €0.40 | €4.60 |
| League season (10 weeks) | €50 | €4.00 | €46.00 |
| Tournament entry | €15 | €1.20 | €13.80 |
| Monthly club membership | €20 | €1.60 | €18.40 |

**10 clubs × 50 players × €20/month = ~€800/month revenue for PickleJ**

### Cash payments

Many clubs (especially in Portugal) prefer cash. The platform must support both:
- "Cash" as a payment method — organizer marks as paid manually in-app
- PickleJ tracks who paid (cash or online) in the same system
- Don't force digital payments — make it optional per club/event
- Hybrid model: some players online, some cash, both tracked together

### Alternative/complementary models

| Model | Target | Pricing |
|---|---|---|
| Club subscription | Club admins | €10-30/month per club |
| Freemium | Everyone | Free basic, paid advanced features |
| Event fee | Per event | €1-3 per event |

### Implementation

| Task | Effort |
|---|---|
| Stripe Connect integration | ~1 week |
| Payment UI (checkout, receipts) | ~3 days |
| Club payout dashboard | ~2 days |
| Refunds/cancellations | ~1 day |
| Cash tracking feature | ~1 day |
| **Total** | ~2-3 weeks |

### Stripe costs

| Fee type | Amount |
|---|---|
| Stripe processing | 2.9% + €0.25 per transaction |
| Stripe Connect | Additional 0.5% for connected accounts |
| Apple/Google in-app purchase | **30%** — avoid by billing on web |

**Important:** Don't sell subscriptions inside the iOS app. Direct users to the website for billing ("Manage subscription at picklej.app/billing"). This avoids Apple's 30% cut.

---

## 5. Tax & Compliance (EU/Portugal)

### Stripe reporting — DAC7

The EU DAC7 directive requires platforms to report seller income to tax authorities.

**Threshold:** Stripe reports a Connected Account (club) when they exceed **€2,000 AND 25+ transactions** in a calendar year on the platform.

- **Below threshold:** Stripe does NOT proactively report to tax authorities
- **Above threshold:** Stripe reports earnings to relevant EU tax authority
- **Either way:** The club/organizer is legally responsible for declaring their income

### PickleJ's obligations

- PickleJ as platform has no direct obligation to report individual club earnings — Stripe handles DAC7 compliance
- Stripe issues annual summaries to Connected Accounts for their own tax filing
- PickleJ should keep records of all transactions for its own accounting

### Cash payments

- Entirely outside Stripe and tax reporting
- Between organizer and players directly
- PickleJ can track cash payments for organizer convenience (record-keeping), but it's not a financial transaction through the platform
- Cash income is the organizer's responsibility to declare

### Regulatory

- Stripe Connect handles PSD2 and SCA compliance
- No payment license needed for PickleJ — Stripe is the payment processor
- Standard Portuguese company tax obligations apply to PickleJ's own revenue (platform fees)

---

## 6. Recommended Timeline

| Phase | What | When |
|---|---|---|
| **Now** | Core features, UX polish, 3-5 clubs using it | Current |
| **Phase 1** | Custom domain, password reset email, push notifications | When ready to go public |
| **Phase 2** | Capacitor wrap + App Store listing | After Phase 1 |
| **Phase 3** | Stripe Connect payments (optional per club) | When clubs ask for it (3-5 active clubs) |
| **Phase 4** | Scale infrastructure (Neon Pro, Vercel Pro) | When approaching 500+ users |

---

## 7. MBWay Payment Integration (Portugal)

### Model: SaaS fee, not payment processing

PickleJ never touches the money. It's a tracking/convenience layer.

1. Club sets their MBWay number (personal or business) in club settings
2. Player signs up for event → sees payment info
3. Player pays directly via MBWay (phone-to-phone)
4. Player taps "I've paid" in PickleJ
5. Organizer confirms when they see the MBWay notification
6. PickleJ charges the club a monthly **service fee** (not a payment cut)

### Service fee options

| Model | Price | Works for |
|---|---|---|
| Flat monthly | €15-30/month per club | Simple, predictable |
| Per active player | €0.50-1/player/month | Scales with usage |
| Per event | €2-5/event | Low-volume clubs |

PickleJ invoices the club monthly — normal B2B fatura, standard 23% IVA. No payment license needed, no DAC7 reporting, no compliance overhead.

### UX: Player payment screen

```
┌─────────────────────────────┐
│  📱 MBWay Payment           │
│                             │
│  To:     912 345 678   [📋] │
│  Amount: €5.00         [📋] │
│                             │
│  Open your MBWay/bank app   │
│  and send the amount above  │
│                             │
│  [✓ I've paid]    [Cancel]  │
└─────────────────────────────┘
```

- Tap 📋 copies to clipboard
- No deep-linking (MBWay doesn't support pre-filled amount/recipient)
- This is the standard UX for MBWay payments in Portugal (restaurants, shops)

### UX: Organizer player list

```
┌─────────────────────────────┐
│  Johan A          ✓ Paid    │
│  Maria S          ⏳ Pending │  ← tap to confirm
│  Pedro M          💵 Cash    │
│  Ana R            — No fee  │
└─────────────────────────────┘
```

- Organizer taps pending → confirms when MBWay payment received
- Mixed methods supported: MBWay, cash, Stripe, pre-paid members, free

### Configuration

- Club sets MBWay number once in club settings (applies to all events)
- Per-event override possible (different organizer = different number)
- Event can set entry fee or leave it free (free events skip payment step)
- Future: MBWay QR code support (organizer uploads their QR, player scans)

### Payment verification

There is no automatic MBWay verification — SIBS doesn't offer an API for personal accounts. Verification is manual, trust-based (same as every small business in Portugal today).

**Real-time flow (typical):**
1. Player signs up Monday for Wednesday's event → pays MBWay → taps "I've paid"
2. Organizer gets MBWay notification on their phone immediately
3. Organizer opens PickleJ → taps confirm → done

Most organizers check as notifications come in — not a daily batch.

**Batch reconciliation view (for busy organizers):**

```
┌─────────────────────────────────┐
│  Wednesday Doubles · €5         │
│  12 paid · 3 pending · 5 free   │
│                                 │
│  ⏳ Maria S    signed up 2h ago  │  [✓] [✕]
│  ⏳ Pedro M    signed up 1d ago  │  [✓] [✕]
│  ⏳ Ana R      signed up 3d ago  │  [✓] [✕]
│                                 │
│  [✓ Confirm all]                │
└─────────────────────────────────┘
```

Organizer opens bank app, scrolls through MBWay received, cross-checks, taps confirm. 2 minutes.

**Auto-reminder:** If payment is still "pending" 24h before the event → PickleJ sends a reminder to the player: "Your payment for Wednesday Doubles is pending. Please pay €5 to 912 345 678."

**For clubs that want guaranteed verification:** Use Stripe instead of MBWay — automatic, verified, no manual checking. MBWay is the casual/trust option, Stripe is the bulletproof option.

### Why this works

- **Zero payment compliance** — PickleJ is SaaS, not a payment processor
- **MBWay has no fees** — clubs love it
- **Personal advantage stays** — payment is phone-to-phone, invisible to tax reporting
- **Works alongside Stripe** — clubs choose per event (MBWay for casual, Stripe for tournaments)
- **Everyone in Portugal has MBWay** — no onboarding friction

---

## 8. Bundle Purchases & Player Wallet

A complementary model on top of per-event billing: **bundle purchases with a
per-user balance tracked by PickleJ.**

### The idea

Instead of paying for each event individually, players buy a bundle:
- **Pay for 10 events upfront → get X% discount** (e.g. 10% off, so 10 events
  for the price of 9)
- **Pay for 20 events → bigger discount** (e.g. 15% off)
- **Monthly/seasonal pass** → unlimited events at a flat fee, or a cap

When the player joins an event, PickleJ deducts one "credit" (or the event's
cash price) from their wallet balance. No payment needed at the door.

### Why this is useful

- **Fewer transactions** — the club does one MBWay/Stripe receipt per bundle
  instead of one per event. Less manual verification, less bookkeeping.
- **Cash flow** — the club gets paid upfront, even for events the player
  eventually skips. (Standard gym/studio model.)
- **Discount as commitment device** — players save a little, clubs lock in
  attendance.
- **Players prefer it** — one payment beats "pay 5 euros every Tuesday night".
- **PickleJ becomes stickier** — the player has a balance they don't want to
  lose; they'll keep coming back.

### What PickleJ needs to track

- **Per-user wallet balance per club** — a user can have separate balances
  at different clubs (they don't share across clubs).
  - Stored value: either monetary (€20 credit) or event-count (8 events left)
  - Probably both: "8 event credits OR €20 cash balance" — clubs pick the
    model they want
- **Transaction ledger per wallet** — every purchase, every deduction, with
  timestamp + reference (which event was used, which bundle was bought)
- **Expiration policy** — some bundles expire (e.g. "valid for 90 days"),
  others don't. Configurable per bundle.
- **Refund rules** — what happens if a player cancels an event after
  registering? Credit back to wallet? Non-refundable? Configurable per club.
- **Bundle definitions per club** — each club creates the bundles they sell
  (5-pack, 10-pack, monthly, etc.) with their own prices and discounts.

### Payment flow

1. Club creates a bundle: "10-event pack · €45 (save €5)"
2. Player buys the bundle via the usual payment path:
   - Stripe Connect → Stripe charges the card, funds go to club, PickleJ
     takes its platform fee
   - MBWay → player sends payment to club's personal MBWay number, club
     confirms the money arrived in the app, PickleJ adds credits
3. PickleJ records the transaction and credits the player's wallet
4. When the player joins an event, PickleJ checks wallet balance → auto-deducts
5. Player sees their balance in the app; club sees each player's balance in
   the member list

### MBWay synergy

MBWay is especially good for bundle purchases because:
- **One MBWay transaction instead of ten** — the manual confirmation burden
  drops dramatically. Verifying 10 tiny per-event payments was the main
  friction of the MBWay approach. One bundle confirmation solves it.
- **Club gets one big round number** (€45) instead of ten awkward small ones
  (€5 × 10). Easier to spot in the bank app.
- **Player sees the full history in PickleJ** — even though the actual money
  moved once, the app records all 10 event usages individually.

This is the feature that makes the MBWay SaaS model viable at scale.

### Billing models to support

From simplest to most flexible:

| Model | Description |
|---|---|
| **Cash / Stripe per event** | Status quo. One payment per event. |
| **Event-count bundles** | "10 events for €45" — credits deducted on use |
| **Monetary wallet** | "Top up €50, each event deducts €5" — flexible pricing |
| **Monthly pass** | "€30/month, unlimited events" — no per-event deduction |
| **Seasonal pass** | "€100 for the summer season" — flat-rate |
| **Hybrid (staff plan)** | "Club members get discounted bundles + can also pay cash" |

Probably start with event-count bundles and monetary wallets as the two core
options, add others based on club demand.

### PickleJ's revenue from bundles

- **SaaS fee model (MBWay/personal)**: flat € per bundle sold, or a % of
  bundle value. Same model as per-event, just charged on the bundle purchase
  event.
- **Stripe Connect model**: the existing platform fee on the bundle purchase
  transaction. One fee on the big upfront payment instead of many small fees.

Either way, PickleJ's transaction count drops, which means Stripe fees drop
too (each transaction has a fixed component).

### Implementation notes

- New DB models: `Wallet` (clubId × playerId × type × balance), `WalletTransaction`
  (ledger), `BundleDefinition` (per-club product catalog), `WalletPurchase`
  (the "I bought this bundle" event).
- UI: player-facing wallet page ("Your credits at Pickle Novopadel Setubal:
  8 events left, expires May 15"), club-facing bundle designer and balance
  overview.
- Trust & reconciliation: an auditable ledger is non-negotiable. Every
  deduction must reference the event that consumed it. Every credit must
  reference the purchase or refund that added it.

### Risks / open questions

- **Expiry policy** — soft law in some jurisdictions prevents aggressive
  expiry on prepaid balances. Check Portugal / EU consumer-protection rules
  before shipping expiring bundles.
- **Club closing** — what happens to player wallets if a club shuts down?
  Terms & conditions should make this explicit: wallets are a promise from
  the club, not from PickleJ. PickleJ doesn't hold the money.
- **Cross-club credit portability** — wallets don't cross clubs, so a player
  visiting a new club still needs a new wallet there. This is the right
  model (each club is a business) but needs to be clear in the UI.

---

## 9. Why This Makes PickleJ Sticky

Once a club routes payments through PickleJ:
- Player records, match history, ratings — all in PickleJ
- Financial records, payment history — all in PickleJ  
- Switching costs become high
- It's not just an app anymore — it's their business infrastructure

The combination of **free core features** + **optional payment processing** is the proven model (Square, Stripe, Toast). Give away the software, monetize the transactions.
