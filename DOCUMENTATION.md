# PickleJ Documentation

> Pickleball & Padel Matchmaking and Scoring PWA

**Live URL**: [picklej.vercel.app](https://picklej.vercel.app)

---

## Table of Contents

- [App Overview](#app-overview)
- [User Roles](#user-roles)
- [User Guide](#user-guide)
  - [Getting Started](#getting-started)
  - [Players](#players)
  - [Events](#events)
  - [Event Flow](#event-flow)
  - [Matches](#matches)
  - [ELO Rating System](#elo-rating-system)
  - [Rankings / Leaderboard](#rankings--leaderboard)
- [Technical Documentation](#technical-documentation)
  - [Tech Stack](#tech-stack)
  - [Data Model (Prisma)](#data-model-prisma)
  - [Key Files](#key-files)
  - [API Route Patterns](#api-route-patterns)
  - [Auth Flow](#auth-flow)
  - [PWA](#pwa)
  - [Deployment](#deployment)

---

## App Overview

PickleJ is a Progressive Web App (PWA) for organizing pickleball and padel sessions. It handles player management, event creation, automated match generation with multiple pairing algorithms, live score tracking, and ELO-based rankings.

- Built with Next.js 16, Prisma 6, PostgreSQL (Neon), deployed on Vercel
- Mobile-first design, installable as a home screen app
- Network-first caching via service worker for offline resilience

---

## User Roles

| Role | Description |
|------|-------------|
| **Admin** | Can manage players, create events, generate matches, submit/edit scores, reset events/ratings. The admin role is set directly in the database. |
| **Regular User** | Can view everything, edit their own profile, sign up for or leave events. Cannot submit scores or manage other players. |
| **Unclaimed Player** | A player entry created by an admin that has not yet been claimed by an actual user. |

---

## User Guide

### Getting Started

1. An admin creates player entries for each person.
2. The admin shares invite links so players can claim their accounts (set email and password).
3. Players sign in at `/signin`.

### Players

Each player has: name, emoji avatar, gender (optional, M/F), ELO rating (starts at 1000), and a win/loss record.

**Admin capabilities:**
- Add players
- Edit any player
- Void or delete players
- Invite unclaimed players (generate invite link)
- Reset passwords (generate reset link)
- Reset ELO ratings

**Player capabilities:**
- Edit their own name, emoji, and gender

### Events

An event represents a play session (e.g. "Saturday Pickleball"). Events are configured with the following settings:

| Setting | Options |
|---------|---------|
| Name | Free text |
| Date/Time | Date and time picker |
| Format | Doubles or Singles |
| Number of Courts | Integer |
| Sets per Match | 1, 2, or 3 |
| Scoring Type | To 11 (win by 2), To 15, Rally 21, Timed (set minutes) |
| Pairing Mode | See below |

**Pairing Modes:**

| Mode | Description |
|------|-------------|
| Random | Round-robin, everyone plays, minimize repeats |
| Skill Balanced | Similar ratings play each other |
| Mixed Gender | Each doubles team has 1 male + 1 female |
| Skill + Mixed | Both skill balance and gender mixing |
| King of Court | Winners stay on court, losers rotate (one round at a time) |
| Swiss | Pair by win/loss record (one round at a time) |
| Manual | Admin adds matches one by one |

### Event Flow

1. Admin creates the event and selects players.
2. Players can also self-signup using the Join Event button.
3. Admin generates matches or adds them manually.
4. Admin enters scores after each match is played.
5. ELO ratings update automatically based on results.
6. Admin can generate additional rounds after all current matches complete.
7. Admin can reset the entire event, which deletes all matches and reverses all ELO changes.

### Matches

- Matches are organized by rounds and courts.
- Each match has two teams (1v1 for singles, 2v2 for doubles).
- Admin submits scores, which triggers ELO rating changes.
- Admin can edit completed scores (ELO is recalculated).
- Admin can add matches manually at any time.
- Admin can delete pending or active matches.
- Admin can swap players in unscored matches.

### ELO Rating System

- Uses a K-factor of 32.
- Formula: `K * (1 - 1 / (1 + 10^((loserRating - winnerRating) / 400)))`
- All team members receive the same ELO change.
- ELO changes are stored on the match record to support reversal.

### Rankings / Leaderboard

- Players are ranked by ELO rating (highest first).
- The leaderboard shows rating, win/loss record, and total matches played.
- Players with no matches are shown separately as "Unranked".

---

## Technical Documentation

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4 |
| Backend | Next.js API routes (serverless functions) |
| Database | PostgreSQL via Neon (serverless Postgres) |
| ORM | Prisma 6 with Prisma Client |
| Auth | NextAuth v5 with Credentials provider, JWT sessions |
| Deployment | Vercel (auto-deploy from GitHub, manual via `npx vercel --prod`) |
| PWA | Service worker with network-first caching strategy |

### Data Model (Prisma)

**Player**
- `id`, `name`, `emoji`, `rating`, `wins`, `losses`, `email`, `passwordHash`, `role`, `status`, `gender`, `inviteToken`, `resetToken`, `photoUrl`

**Event**
- `id`, `name`, `date`, `status` (setup / active / completed), `numCourts`, `format`, `numSets`, `scoringType`, `timedMinutes`, `pairingMode`

**EventPlayer**
- Links players to events (many-to-many) with a `checkedIn` flag

**Match**
- `id`, `eventId`, `courtNum`, `round`, `status` (pending / active / completed), `eloChange`

**MatchPlayer**
- Links players to matches with team assignment and score

### Key Files

| Path | Purpose |
|------|---------|
| `prisma/schema.prisma` | Database schema |
| `src/lib/auth.ts` | NextAuth config, `requireAuth()` / `requireAdmin()` helpers |
| `src/lib/db.ts` | Prisma client singleton |
| `src/lib/matchgen/` | Match generation module with 7 pairing algorithms |
| `src/lib/matchgen/types.ts` | `PlayerInfo`, `MatchResult`, `PairingMode` types |
| `src/lib/matchgen/algorithms.ts` | All pairing algorithm implementations |
| `src/lib/matchgen/index.ts` | Dispatcher: `generateRounds()` |
| `src/app/api/players/` | Player CRUD API |
| `src/app/api/events/` | Event CRUD API |
| `src/app/api/events/[id]/generate/` | Match generation endpoint |
| `src/app/api/events/[id]/reset/` | Reset event (delete matches, reverse ELO) |
| `src/app/api/events/[id]/signup/` | User self-signup / leave |
| `src/app/api/events/[id]/players/` | Admin add player to event |
| `src/app/api/events/[id]/matches/` | Manual match creation |
| `src/app/api/matches/[id]/score/` | Score submission and editing |
| `src/app/api/matches/[id]/players/` | Swap / delete match players |
| `src/app/players/page.tsx` | Players management page |
| `src/app/events/page.tsx` | Events list with search and filters |
| `src/app/events/new/page.tsx` | New event creation form |
| `src/app/events/[id]/page.tsx` | Event detail (matches, scoring) |
| `src/app/leaderboard/page.tsx` | Rankings page |
| `src/components/Header.tsx` | Fixed header with user info |
| `src/components/BottomNav.tsx` | Bottom tab navigation |

### API Route Patterns

- **Auth guards**: `requireAuth()` for logged-in users, `requireAdmin()` for admin-only endpoints.
- All API routes use Next.js route handlers (App Router).
- Request body is parsed as JSON via `req.json()`.
- Responses use `NextResponse.json(data)` with appropriate status codes.
- Dynamic params follow the Next.js 16 pattern: `{ params }: { params: Promise<{ id: string }> }`.

### Auth Flow

1. Admin creates a player entry.
2. Admin generates an invite token and shares the claim URL.
3. User visits `/claim/[token]` and sets their email and password.
4. User signs in at `/signin` with email and password.
5. A JWT session is stored, containing: `id`, `name`, `email`, `role`, `emoji`.
6. Session lasts 30 days (NextAuth default).
7. Admin can generate password reset links for users who need them.

### PWA

| File | Purpose |
|------|---------|
| `public/manifest.json` | App manifest (name, icons, theme color, start URL) |
| `public/sw.js` | Service worker (network-first strategy, cache fallback) |

- Cache name includes a version string for cache busting.
- The `ServiceWorkerRegister` component auto-registers the service worker and cleans old caches on version change.

### Deployment

| Item | Value |
|------|-------|
| GitHub repo | `github.com/johanahlund/pickleplay` |
| Vercel project | `picklej` |
| Live URL | `https://picklej.vercel.app` |
| Database | Neon PostgreSQL (connection via `DATABASE_URL` env var) |
| Manual deploy | `npx vercel --prod` |
| Schema changes | `npx prisma db push` |
