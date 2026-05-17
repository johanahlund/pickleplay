/**
 * Import a Round of I Liga results from the no-ref-needed.com Base44 app.
 *
 * Status: Round 1 import is pending until captains finish reporting all
 * encounters externally. Run this script once that lands.
 *
 * Usage
 *   # Dry-run (no DB writes)
 *   node scripts/import-no-ref-needed-round.mjs \
 *     --round 1 \
 *     --token "eyJhbGc..." \
 *
 *   # Commit
 *   node scripts/import-no-ref-needed-round.mjs --round 1 --token "..." --commit
 *
 * Get the token: log into no-ref-needed.com, DevTools > Network > XHR > any
 *   /api/apps/.../* request > Headers > Authorization: Bearer <jwt>.
 * Tokens are JWTs; sample we captured 2026-05-17 expires 2026-09-13.
 *
 * What it does
 *   1. Fetch getLeaguePublicData for the target tournament.
 *   2. For each completed encounter on the requested round date, reconcile
 *      the General Ranking from `matches` + patch missing categories from
 *      `category_matches`. Drop stale null-type rows.
 *   3. Resolve each home/away player name → FB Player.id by exact name
 *      match within the LeagueTeam roster. Report unresolved.
 *   4. For each reconciled match, find (or create when --commit) a Match
 *      row linked to the corresponding LeagueGame in the round's event.
 *   5. Set Match.status = "completed", MatchPlayer.score = sets won
 *      (the external `home_score` / `away_score` are sets-won totals).
 *      `Match.setScores` stays null — per-set point data doesn't exist
 *      in the external source.
 *
 * Why no per-set data: confirmed empirically on 2026-05-17. The
 * LeagueEncounter entity stores set-WIN totals only; their UI surfaces a
 * tally like "2-3" with no per-set breakdown. See
 * memory/reference_no_ref_needed_api.md for the discovery notes.
 */

import { PrismaClient } from "@prisma/client";

const APP_ID = "6959c04e87f41000c9209328";
const TOURNAMENT_ID = "6a0086ddc0380e8934f1fa99"; // I Liga Interclubes Zona Centro
const FB_LEAGUE_ID = "cmnthgg6u0001js043pt46mpy"; // FB-side I Liga

// External team names → fuzzy match anchors for FB LeagueTeam.name.
// External often has "Team " prefix; some clubs renamed (e.g. Oeiras).
const TEAM_NAME_ALIASES = {
  "Team Setúbal": ["Setúbal", "Setubal"],
  "Team Lisboa": ["Lisboa"],
  "Team Caldas": ["Caldas"],
  "Team Lourinhã": ["Lourinhã", "Lourinha"],
  "Team Torres Vedras": ["Torres Vedras"],
  "Team Estoril CTE": ["Estoril", "Estoril CTE"],
  "Team Clubepickleball.pt Leiria": ["Leiria"],
  "Pickliceu Oeiras": ["Oeiras"],
};

// Map external match_type → FB LeagueCategory match shape.
// FB stores category by name + a "format" (doubles/singles/mixed) and
// "gender" (M/F/MX). Resolve at runtime against the league's categories.
const MATCH_TYPE_TO_CATEGORY = {
  mens_singles:    { format: "singles", gender: "M"  },
  womens_singles:  { format: "singles", gender: "F"  },
  mens_doubles:    { format: "doubles", gender: "M"  },
  womens_doubles:  { format: "doubles", gender: "F"  },
  mixed_doubles:   { format: "doubles", gender: "MX" },
};

// ─── CLI args ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  return args[i + 1];
}
const ROUND_NUMBER = Number(arg("round")) || 1;
const TOKEN = arg("token");
const COMMIT = args.includes("--commit");
if (!TOKEN) {
  console.error("Missing --token. Get one from DevTools (see file header).");
  process.exit(1);
}

console.log(`\n${COMMIT ? "[COMMIT]" : "[DRY-RUN]"}  importing Round ${ROUND_NUMBER}\n`);

// ─── Fetch external ───────────────────────────────────────────────────
async function fetchLeague() {
  const url = `https://no-ref-needed.com/api/apps/${APP_ID}/functions/getLeaguePublicData`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "X-App-Id": APP_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tournament_id: TOURNAMENT_ID }),
  });
  if (!r.ok) {
    console.error(`getLeaguePublicData → ${r.status}: ${await r.text()}`);
    process.exit(1);
  }
  return r.json();
}

// ─── Reconcile per-encounter General Ranking ──────────────────────────
// Start from `matches`, drop null-type rows, then look at the
// category_matches superset and patch in any category-pair missing
// from `matches` that would otherwise leave the H+A set-total unmet.
function reconcileMatches(encounter) {
  const general = (encounter.matches || []).filter((m) => m.match_type);
  const homeWins = (encounter.home_points ?? 0);
  const awayWins = (encounter.away_points ?? 0);
  const sumWins = general.reduce(
    (acc, m) => acc + (m.winner === "home" ? 1 : m.winner === "away" ? 1 : 0),
    0,
  );
  const expected = homeWins + awayWins;
  if (sumWins === expected) return general;

  // Mismatch — pull from category_matches whatever's not represented
  // by the (home_player1+away_player1+match_type) tuple.
  const haveKey = new Set(general.map((m) =>
    `${m.match_type}|${m.home_player1}|${m.away_player1}`,
  ));
  const extras = [];
  for (const cm of encounter.category_matches || []) {
    const k = `${cm.match_type}|${cm.home_player1}|${cm.away_player1}`;
    if (!haveKey.has(k) && cm.match_type) {
      extras.push(cm);
    }
  }
  // Add extras until set-totals add up.
  const patched = [...general];
  for (const e of extras) {
    const projected = patched.reduce(
      (acc, m) => acc + (m.winner === "home" ? 1 : m.winner === "away" ? 1 : 0),
      0,
    );
    if (projected >= expected) break;
    patched.push(e);
  }
  return patched;
}

// ─── Player name resolution ───────────────────────────────────────────
// Match by exact name within the FB LeagueTeam roster.
// Reports both ambiguous (multiple matches) and missing.
function resolvePlayer(name, team, unresolved) {
  if (!name) return null;
  const trimmed = name.trim();
  const exact = team.players.filter((tp) => tp.player.name === trimmed);
  if (exact.length === 1) return exact[0].player;
  if (exact.length > 1) {
    unresolved.ambiguous.push({ team: team.name, name: trimmed, candidates: exact.map((tp) => tp.player.id) });
    return null;
  }
  // Try case-insensitive
  const ci = team.players.filter((tp) => tp.player.name.toLowerCase() === trimmed.toLowerCase());
  if (ci.length === 1) return ci[0].player;
  // Try first-name-only as a last resort
  const firstName = trimmed.split(/\s+/)[0].toLowerCase();
  const byFirst = team.players.filter((tp) => tp.player.name.split(/\s+/)[0].toLowerCase() === firstName);
  if (byFirst.length === 1) return byFirst[0].player;
  unresolved.missing.push({ team: team.name, name: trimmed });
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────
const prisma = new PrismaClient();

try {
  const ext = await fetchLeague();
  console.log(`External: ${ext.tournament.name} — ${ext.encounters.length} encounters total\n`);

  // Pull FB-side league + round + teams (with roster).
  const league = await prisma.league.findUnique({
    where: { id: FB_LEAGUE_ID },
    include: {
      rounds: { include: { events: true } },
      teams: { include: { players: { include: { player: { select: { id: true, name: true } } } } } },
      categories: true,
    },
  });
  if (!league) { console.error(`FB league ${FB_LEAGUE_ID} not found`); process.exit(1); }
  const round = league.rounds.find((r) => r.roundNumber === ROUND_NUMBER);
  if (!round) { console.error(`FB league has no Round ${ROUND_NUMBER}`); process.exit(1); }
  console.log(`FB league: ${league.name}, Round ${ROUND_NUMBER}, ${round.events.length} events\n`);

  // Resolve team name external → FB LeagueTeam.
  const fbTeamByExt = new Map();
  for (const [extName, aliases] of Object.entries(TEAM_NAME_ALIASES)) {
    const fb = league.teams.find((t) => aliases.some((a) => t.name.includes(a)));
    if (fb) fbTeamByExt.set(extName, fb);
    else console.warn(`  [warn] external team "${extName}" → no FB match`);
  }
  console.log();

  // Track unresolved players across the run.
  const unresolved = { ambiguous: [], missing: [] };
  const plan = [];

  for (const enc of ext.encounters) {
    if (enc.status !== "in_progress" && enc.status !== "completed") continue;
    if (!(enc.matches || []).some((m) => m.winner)) continue; // no scored matches
    const home = fbTeamByExt.get(enc.home_team_name);
    const away = fbTeamByExt.get(enc.away_team_name);
    if (!home || !away) continue;

    // Find the FB event for this encounter in this round.
    const fbEvent = round.events.find((ev) =>
      (ev.hostTeamId === home.id || ev.hostTeamId === away.id)
      && (ev.visitorTeamId === home.id || ev.visitorTeamId === away.id),
    );
    if (!fbEvent) {
      console.warn(`  [warn] no FB event for ${home.name} vs ${away.name} in Round ${ROUND_NUMBER}`);
      continue;
    }

    const matches = reconcileMatches(enc);
    const matchPlan = [];
    for (const m of matches) {
      if (!m.winner) continue;
      const h1 = resolvePlayer(m.home_player1, home, unresolved);
      const h2 = resolvePlayer(m.home_player2, home, unresolved);
      const a1 = resolvePlayer(m.away_player1, away, unresolved);
      const a2 = resolvePlayer(m.away_player2, away, unresolved);
      // We tolerate missing singles partner (h2/a2 null) for singles matches.
      const isSingles = !m.home_player2 && !m.away_player2;
      const allOk = isSingles ? (h1 && a1) : (h1 && h2 && a1 && a2);
      matchPlan.push({
        ext: m,
        homePlayers: [h1, h2].filter(Boolean),
        awayPlayers: [a1, a2].filter(Boolean),
        homeSets: Math.round(m.home_score),
        awaySets: Math.round(m.away_score),
        ok: allOk,
      });
    }
    plan.push({ home, away, fbEvent, matches: matchPlan });
  }

  // ── Report ──
  console.log("=== Import plan ===\n");
  for (const p of plan) {
    console.log(`${p.home.name}  vs  ${p.away.name}   (FB event: ${p.fbEvent.id})`);
    for (const mp of p.matches) {
      const home = mp.homePlayers.map((p) => p.name).join(" / ") || "?";
      const away = mp.awayPlayers.map((p) => p.name).join(" / ") || "?";
      const mark = mp.ok ? "✓" : "✗";
      console.log(`  ${mark}  ${mp.ext.match_type.padEnd(15)} [${home}] vs [${away}]   ${mp.homeSets}-${mp.awaySets}`);
    }
    console.log();
  }
  if (unresolved.missing.length) {
    console.log("=== Missing players (need to be added to FB roster first) ===");
    for (const u of unresolved.missing) console.log(`  ${u.team.padEnd(24)}  ${u.name}`);
    console.log();
  }
  if (unresolved.ambiguous.length) {
    console.log("=== Ambiguous players (multiple FB matches) ===");
    for (const u of unresolved.ambiguous) console.log(`  ${u.team.padEnd(24)}  ${u.name}  candidates=${u.candidates.join(", ")}`);
    console.log();
  }

  if (!COMMIT) {
    console.log("DRY-RUN: re-run with --commit to write to the DB.");
    process.exit(0);
  }

  // ── Commit ──
  // Find or create Match for each reconciled match, link to LeagueGame,
  // set MatchPlayer.score = sets won, leave setScores null.
  console.log("\n=== Writing to FB ===\n");
  let wrote = 0;
  for (const p of plan) {
    for (const mp of p.matches) {
      if (!mp.ok) continue;

      // Resolve LeagueCategory from match_type.
      const cat = MATCH_TYPE_TO_CATEGORY[mp.ext.match_type];
      if (!cat) { console.warn(`skip: unknown match_type ${mp.ext.match_type}`); continue; }
      const fbCat = league.categories.find((c) => c.format === cat.format && c.gender === cat.gender);
      if (!fbCat) { console.warn(`skip: no FB category for ${mp.ext.match_type}`); continue; }

      // Find existing LeagueGame in this event matching the category +
      // either team pairing. (We don't trust home/away ordering — the
      // external app's "home" is the encounter host, which may or may
      // not align with the FB LeagueGame ordering.)
      const game = await prisma.leagueGame.findFirst({
        where: {
          eventId: p.fbEvent.id,
          categoryId: fbCat.id,
          OR: [
            { team1Id: p.home.id, team2Id: p.away.id },
            { team1Id: p.away.id, team2Id: p.home.id },
          ],
        },
      });
      if (!game) { console.warn(`skip: no LeagueGame for ${p.home.name} vs ${p.away.name} ${mp.ext.match_type}`); continue; }

      const game_homeIsTeam1 = game.team1Id === p.home.id;
      const team1Score = game_homeIsTeam1 ? mp.homeSets : mp.awaySets;
      const team2Score = game_homeIsTeam1 ? mp.awaySets : mp.homeSets;
      const team1Players = game_homeIsTeam1 ? mp.homePlayers : mp.awayPlayers;
      const team2Players = game_homeIsTeam1 ? mp.awayPlayers : mp.homePlayers;

      await prisma.$transaction(async (tx) => {
        let match;
        if (game.matchId) {
          match = await tx.match.update({
            where: { id: game.matchId },
            data: {
              status: "completed",
              completedAt: new Date(),
              setScores: null,
            },
          });
          await tx.matchPlayer.deleteMany({ where: { matchId: match.id } });
        } else {
          match = await tx.match.create({
            data: {
              eventId: p.fbEvent.id,
              courtNum: 1,
              round: 1,
              status: "completed",
              completedAt: new Date(),
              setScores: null,
            },
          });
          await tx.leagueGame.update({ where: { id: game.id }, data: { matchId: match.id } });
        }
        for (const pl of team1Players) {
          await tx.matchPlayer.create({ data: { matchId: match.id, playerId: pl.id, team: 1, score: team1Score } });
        }
        for (const pl of team2Players) {
          await tx.matchPlayer.create({ data: { matchId: match.id, playerId: pl.id, team: 2, score: team2Score } });
        }
        // Set the LeagueGame winner.
        const winnerTeamId = team1Score > team2Score ? game.team1Id : game.team2Id;
        await tx.leagueGame.update({ where: { id: game.id }, data: { winnerId: winnerTeamId } });
      });
      wrote++;
      console.log(`  wrote ${p.home.name} vs ${p.away.name}: ${mp.ext.match_type} ${team1Score}-${team2Score}`);
    }
  }
  console.log(`\nDone. ${wrote} matches written. Re-run /api/leagues/<id> standings to recompute team points.\n`);

} finally {
  await prisma.$disconnect();
}
