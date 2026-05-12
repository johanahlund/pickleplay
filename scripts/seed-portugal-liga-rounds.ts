/**
 * Seed rounds 2–7 of "I Liga Interclubes Pickleball Zona Centro - Portugal"
 * + their match-day events, mirroring how round 1 was created via the
 * UI (`POST /api/leagues/[id]/rounds/[roundId]/events`):
 *
 *   - LeagueRound (roundNumber + startDate/endDate)
 *   - Event with 5 EventClass rows (M/F doubles, mixed, M/F singles)
 *   - LeagueEventTeam x2 (home + away)
 *   - LeagueGame x N (one per league category, for standings)
 *
 * Assumptions (confirmed by the user):
 *   - Year is 2026.
 *   - "Caldas da Rainha" → existing team named "Caldas".
 *   - Event happens on the FIRST date of the two-day round window.
 *   - Event createdById = home team captain (or vice-captain fallback).
 *   - Same 5 classes as round 1; LeagueGame rows pre-created for each
 *     of the league's accepted categories (status != "draft").
 *
 * Re-run safe: skips rounds/events that already exist (matched by
 * roundNumber + the unordered team-pair).
 *
 * Run with:
 *   npx tsx scripts/seed-portugal-liga-rounds.ts
 */

import { prisma } from "../src/lib/db";

const LEAGUE_NAME_CONTAINS = "I Liga Interclubes Pickleball Zona Centro";

// Canonical team-name aliases. Map the source label → DB name.
const TEAM_ALIASES: Record<string, string> = {
  "Caldas da Rainha": "Caldas",
};
function canonicalTeamName(name: string): string {
  return TEAM_ALIASES[name] ?? name;
}

type RoundDef = {
  roundNumber: number;
  start: string; // ISO YYYY-MM-DD
  end: string;   // ISO YYYY-MM-DD
  matches: { home: string; away: string }[];
};

const ROUNDS: RoundDef[] = [
  { roundNumber: 2, start: "2026-06-06", end: "2026-06-07", matches: [
    { home: "Lourinhã", away: "Torres Vedras" },
    { home: "Caldas da Rainha", away: "Leiria" },
    { home: "Lisboa", away: "Setúbal" },
    { home: "Oeiras", away: "Estoril" },
  ]},
  { roundNumber: 3, start: "2026-06-13", end: "2026-06-14", matches: [
    { home: "Leiria", away: "Estoril" },
    { home: "Torres Vedras", away: "Setúbal" },
    { home: "Lourinhã", away: "Lisboa" },
    { home: "Caldas da Rainha", away: "Oeiras" },
  ]},
  { roundNumber: 4, start: "2026-07-04", end: "2026-07-05", matches: [
    { home: "Setúbal", away: "Leiria" },
    { home: "Estoril", away: "Torres Vedras" },
    { home: "Lisboa", away: "Caldas da Rainha" },
    { home: "Oeiras", away: "Lourinhã" },
  ]},
  { roundNumber: 5, start: "2026-08-22", end: "2026-08-23", matches: [
    { home: "Leiria", away: "Torres Vedras" },
    { home: "Estoril", away: "Setúbal" },
    { home: "Lourinhã", away: "Caldas da Rainha" },
    { home: "Lisboa", away: "Oeiras" },
  ]},
  { roundNumber: 6, start: "2026-09-05", end: "2026-09-06", matches: [
    { home: "Torres Vedras", away: "Lisboa" },
    { home: "Setúbal", away: "Lourinhã" },
    { home: "Caldas da Rainha", away: "Estoril" },
    { home: "Oeiras", away: "Leiria" },
  ]},
  { roundNumber: 7, start: "2026-09-12", end: "2026-09-13", matches: [
    { home: "Leiria", away: "Lisboa" },
    { home: "Torres Vedras", away: "Oeiras" },
    { home: "Estoril", away: "Lourinhã" },
    { home: "Setúbal", away: "Caldas da Rainha" },
  ]},
];

async function main() {
  const league = await prisma.league.findFirst({
    where: { name: { contains: LEAGUE_NAME_CONTAINS, mode: "insensitive" } },
    include: {
      teams: { select: { id: true, name: true, captainId: true, viceCaptainId: true, clubId: true } },
      categories: { select: { id: true, name: true, format: true, gender: true, scoringFormat: true, winBy: true, status: true, sortOrder: true } },
      rounds: { select: { id: true, roundNumber: true } },
    },
  });
  if (!league) {
    console.error(`No league found matching "${LEAGUE_NAME_CONTAINS}"`);
    process.exit(1);
  }
  console.log(`League: ${league.name} (${league.id})`);

  // Look up teams by name. Fail loudly if any are missing.
  const teamByName = new Map<string, typeof league.teams[0]>();
  for (const t of league.teams) teamByName.set(t.name, t);
  const findTeam = (raw: string) => {
    const canonical = canonicalTeamName(raw);
    const t = teamByName.get(canonical);
    if (!t) throw new Error(`Team not found in league: "${raw}" (canonical "${canonical}")`);
    return t;
  };

  // Active (non-draft) categories with FK ids — used for LeagueGame rows.
  const activeCats = league.categories
    .filter((c) => c.status !== "draft")
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  console.log(`Active categories (${activeCats.length}): ${activeCats.map((c) => c.name).join(", ")}`);

  let createdRounds = 0;
  let skippedRounds = 0;
  let createdEvents = 0;
  let skippedEvents = 0;

  for (const def of ROUNDS) {
    let round = league.rounds.find((r) => r.roundNumber === def.roundNumber);
    if (!round) {
      round = await prisma.leagueRound.create({
        data: {
          leagueId: league.id,
          roundNumber: def.roundNumber,
          name: `Round ${def.roundNumber}`,
          startDate: new Date(def.start),
          endDate: new Date(def.end),
          status: "setup",
        },
        select: { id: true, roundNumber: true },
      });
      createdRounds++;
      console.log(`  + Round ${def.roundNumber} created (${def.start} → ${def.end})`);
    } else {
      // Update dates if they differ — keep status alone.
      await prisma.leagueRound.update({
        where: { id: round.id },
        data: { startDate: new Date(def.start), endDate: new Date(def.end) },
      });
      skippedRounds++;
      console.log(`  · Round ${def.roundNumber} already exists — dates synced`);
    }

    for (const m of def.matches) {
      const home = findTeam(m.home);
      const away = findTeam(m.away);

      // Skip if an event with these two teams already exists in the round.
      const existing = await prisma.event.findFirst({
        where: {
          roundId: round.id,
          AND: [
            { leagueTeams: { some: { teamId: home.id } } },
            { leagueTeams: { some: { teamId: away.id } } },
          ],
        },
        select: { id: true, name: true },
      });
      if (existing) {
        skippedEvents++;
        console.log(`    · Event exists: ${existing.name}`);
        continue;
      }

      const captainId = home.captainId ?? home.viceCaptainId ?? null;
      const eventName = `${league.name}: ${home.name} vs ${away.name} — Round ${def.roundNumber}`;
      const eventDate = new Date(def.start);

      // Build the 5 standard class rows. `isDefault: i === 0` keeps the
      // first one as the default class for the event.
      const classData = activeCats.map((cat, i) => ({
        name: cat.name,
        format: cat.format,
        gender: cat.gender,
        scoringFormat: cat.scoringFormat,
        winBy: cat.winBy,
        isDefault: i === 0,
      }));

      const event = await prisma.event.create({
        data: {
          name: eventName,
          date: eventDate,
          numCourts: 2,
          status: "setup",
          createdById: captainId, // null is acceptable — schema allows it
          clubId: home.clubId,
          roundId: round.id,
          hostTeamId: home.id,
          classes: { create: classData },
          leagueTeams: {
            create: [{ teamId: home.id }, { teamId: away.id }],
          },
        },
        select: { id: true },
      });

      // Sort team ids canonical (matches the lineup-builder code) for
      // team1Id < team2Id ordering on LeagueGame.
      const [t1Id, t2Id] = [home.id, away.id].sort((a, b) => a.localeCompare(b));
      for (const cat of activeCats) {
        await prisma.leagueGame.create({
          data: {
            eventId: event.id,
            categoryId: cat.id,
            team1Id: t1Id,
            team2Id: t2Id,
            createdById: captainId,
          },
        });
      }
      createdEvents++;
      console.log(`    + ${eventName}${captainId ? "" : "  (no captain — createdById=null)"}`);
    }
  }

  console.log(`\nRounds: created ${createdRounds}, skipped ${skippedRounds}`);
  console.log(`Events: created ${createdEvents}, skipped ${skippedEvents}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
