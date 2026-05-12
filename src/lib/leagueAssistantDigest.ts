import { prisma } from "@/lib/db";

/**
 * Builds a compact markdown digest of a league's live state — teams,
 * rosters, rounds, match-day games (with lineups + winners), and a
 * computed general-standings table. Fed to the jabberBrain League
 * Assistant alongside the rules PDF so it can answer questions about
 * matches/lineups/results in addition to the rules.
 *
 * Designed to stay small (a few thousand tokens at most) for a typical
 * 8-team / 7-round league. If you ever need to scale beyond that, swap
 * for tool-use (model fetches what it needs).
 *
 * Returns "" when the league is missing — the caller falls back to
 * rules-only mode.
 */
export async function buildLeagueAssistantDigest(leagueId: string): Promise<string> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      name: true,
      shortName: true,
      season: true,
      status: true,
      config: true,
      categories: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, format: true, gender: true, ageGroup: true },
      },
      teams: {
        select: {
          id: true,
          name: true,
          captain: { select: { name: true } },
          viceCaptain: { select: { name: true } },
          club: { select: { name: true } },
          players: {
            select: {
              player: { select: { id: true, name: true, gender: true } },
            },
          },
        },
      },
      rounds: {
        orderBy: { roundNumber: "asc" },
        select: {
          id: true,
          roundNumber: true,
          name: true,
          startDate: true,
          endDate: true,
          status: true,
          events: {
            orderBy: { date: "asc" },
            select: {
              id: true,
              name: true,
              date: true,
              status: true,
              hostTeamId: true,
              // Event-level latch: true once the event has revealed
              // lineups. Never resets. The assistant is open-access, so
              // we treat unrevealed lineups as confidential. Per-team
              // lineupReady flags don't matter — the event-level lock
              // is the only signal we use.
              lineupTotalLocked: true,
              leagueTeams: { select: { teamId: true, points: true } },
              leagueGames: {
                select: {
                  id: true,
                  kind: true,
                  categoryId: true,
                  team1Id: true,
                  team2Id: true,
                  winnerId: true,
                  scheduledAt: true,
                  courtNum: true,
                  category: { select: { name: true } },
                  team1: { select: { name: true } },
                  team2: { select: { name: true } },
                  winner: { select: { name: true } },
                  gamePlayers: {
                    select: {
                      player: { select: { id: true, name: true } },
                    },
                  },
                  match: {
                    select: {
                      players: { select: { team: true, score: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!league) return "";

  const config = (league.config as Record<string, number> | null) || {};
  const maxPointsPerMD = typeof config.maxPointsPerMatchDay === "number" ? config.maxPointsPerMatchDay : 99;

  // Lightweight standings: same shape as /standings route's general
  // list, simplified — points (capped per match-day), wins/losses, and
  // total category wins. Tiebreakers omitted because the LLM doesn't
  // need them; for exact tied-team ordering, the operator points the
  // user at the Standings tab.
  type Row = { teamId: string; name: string; played: number; won: number; lost: number; drawn: number; points: number; catWins: number };
  const rows = new Map<string, Row>();
  for (const t of league.teams) {
    rows.set(t.id, { teamId: t.id, name: t.name, played: 0, won: 0, lost: 0, drawn: 0, points: 0, catWins: 0 });
  }

  for (const round of league.rounds) {
    for (const ev of round.events) {
      const mdWins: Record<string, number> = {};
      for (const g of ev.leagueGames) {
        if (g.kind === "extra") continue;
        if (g.winnerId) {
          mdWins[g.winnerId] = (mdWins[g.winnerId] || 0) + 1;
          const row = rows.get(g.winnerId);
          if (row) row.catWins++;
        }
      }
      const hasResults = ev.leagueGames.some((g) => g.winnerId && g.kind !== "extra");
      if (!hasResults) continue;
      const teamIds = ev.leagueTeams.map((t) => t.teamId);
      for (const tid of teamIds) {
        const row = rows.get(tid);
        if (!row) continue;
        row.played++;
        row.points += Math.min(mdWins[tid] || 0, maxPointsPerMD);
      }
      if (teamIds.length === 2) {
        const [a, b] = teamIds;
        const aw = mdWins[a] || 0;
        const bw = mdWins[b] || 0;
        if (aw > bw) { rows.get(a)!.won++; rows.get(b)!.lost++; }
        else if (bw > aw) { rows.get(b)!.won++; rows.get(a)!.lost++; }
        else { rows.get(a)!.drawn++; rows.get(b)!.drawn++; }
      }
    }
  }
  const standings = Array.from(rows.values()).sort((a, b) => b.points - a.points || b.catWins - a.catWins || a.name.localeCompare(b.name));

  // playerId → which team they belong to. Lets us split a game's
  // lineup ("Alice + Bob + Carla + David") into the two team groups
  // ("Setúbal: Alice + Bob | Oeiras: Carla + David") so the model
  // never has to cross-reference rosters to answer "who played for X".
  const playerToTeamName = new Map<string, string>();
  for (const t of league.teams) {
    for (const p of t.players) {
      const pid = p.player?.id;
      if (pid) playerToTeamName.set(pid, t.name);
    }
  }

  // ── Format as markdown ────────────────────────────────────────────
  const lines: string[] = [];
  lines.push(`# League data: ${league.name}${league.shortName ? ` (${league.shortName})` : ""}`);
  lines.push(`Season: ${league.season ?? "—"} · Status: ${league.status}`);
  if (league.categories.length) {
    lines.push("");
    lines.push("## Categories");
    for (const c of league.categories) {
      const bits = [c.format, c.gender, c.ageGroup].filter((s) => s && s !== "any");
      lines.push(`- ${c.name}${bits.length ? ` (${bits.join(" · ")})` : ""}`);
    }
  }

  lines.push("");
  lines.push("## Teams & rosters");
  for (const t of league.teams) {
    const cap = t.captain?.name ? `captain ${t.captain.name}` : null;
    const vice = t.viceCaptain?.name ? `vice ${t.viceCaptain.name}` : null;
    const club = t.club?.name ? `club ${t.club.name}` : null;
    const headerBits = [cap, vice, club].filter(Boolean).join(" · ");
    lines.push(`- ${t.name}${headerBits ? ` — ${headerBits}` : ""}`);
    if (t.players.length) {
      const roster = t.players
        .map((p) => p.player?.name)
        .filter((n): n is string => Boolean(n))
        .join(", ");
      if (roster) lines.push(`  Roster: ${roster}`);
    }
  }

  // Standings table (only if anything has been played).
  if (standings.some((r) => r.played > 0)) {
    lines.push("");
    lines.push("## Standings (general, points capped per match-day)");
    lines.push("| # | Team | Pts | Played | W | L | D | Cat wins |");
    lines.push("|---|------|-----|--------|---|---|---|----------|");
    standings.forEach((r, i) => {
      lines.push(`| ${i + 1} | ${r.name} | ${r.points} | ${r.played} | ${r.won} | ${r.lost} | ${r.drawn} | ${r.catWins} |`);
    });
    lines.push("");
    lines.push("Tiebreakers (omitted from this table) are: 1) direct H2H, 2) total category wins, 3) point difference. For the exact ranking when teams are tied on points, refer the user to the Standings tab on the league page.");
  }

  // Rounds + match-days + games.
  lines.push("");
  lines.push("## Rounds & match-days");
  for (const round of league.rounds) {
    const window = [round.startDate, round.endDate].filter(Boolean).map((d) => new Date(d!).toLocaleDateString("en-CA")).join(" → ");
    lines.push(`### Round ${round.roundNumber}${round.name ? ` — ${round.name}` : ""}${window ? ` (${window})` : ""} · ${round.status}`);
    if (round.events.length === 0) {
      lines.push("- _no match-days yet_");
      continue;
    }
    for (const ev of round.events) {
      const dateStr = ev.date ? new Date(ev.date).toLocaleDateString("en-CA") : "—";
      const lineupRevealed = ev.lineupTotalLocked === true;
      const lineupTag = lineupRevealed ? "lineups revealed" : "lineups hidden (event not yet locked)";
      lines.push(`- ${ev.name} · ${dateStr} · status ${ev.status} · ${lineupTag}`);
      if (ev.leagueGames.length === 0) {
        lines.push("  _no games scheduled_");
        continue;
      }
      // Sort principal first so they read like the main scoreboard.
      const sortedGames = ev.leagueGames.slice().sort((a, b) => {
        const kindRank = (k: string) => (k === "principal" ? 0 : k === "league" ? 1 : 2);
        return kindRank(a.kind) - kindRank(b.kind);
      });
      for (const g of sortedGames) {
        let score = "";
        if (g.match?.players?.length) {
          const t1 = g.match.players.filter((p) => p.team === 1).reduce((s, p) => Math.max(s, p.score), 0);
          const t2 = g.match.players.filter((p) => p.team === 2).reduce((s, p) => Math.max(s, p.score), 0);
          if (t1 || t2) score = ` ${t1}-${t2}`;
        }
        const winner = g.winner?.name ? ` → winner ${g.winner.name}` : g.winnerId ? "" : " (pending)";
        const kindTag = g.kind !== "league" ? ` [${g.kind}]` : "";
        lines.push(`  - ${g.category.name}${kindTag}: ${g.team1.name} vs ${g.team2.name}${score}${winner}`);

        // Lineup line — confidential until the event is locked.
        if (!lineupRevealed) {
          lines.push(`    lineup: hidden until the event is locked`);
          continue;
        }
        if (g.gamePlayers.length === 0) {
          lines.push(`    lineup: not yet assigned`);
          continue;
        }

        // Group this game's revealed lineup by team so the model can
        // answer "who played for X" without cross-referencing rosters.
        const team1Players: string[] = [];
        const team2Players: string[] = [];
        const otherPlayers: string[] = [];
        for (const gp of g.gamePlayers) {
          const name = gp.player?.name;
          if (!name) continue;
          const pid = gp.player?.id;
          const teamName = pid ? playerToTeamName.get(pid) : undefined;
          if (teamName === g.team1.name) team1Players.push(name);
          else if (teamName === g.team2.name) team2Players.push(name);
          else otherPlayers.push(name);
        }
        const parts: string[] = [];
        if (team1Players.length) parts.push(`${g.team1.name}: ${team1Players.join(" + ")}`);
        if (team2Players.length) parts.push(`${g.team2.name}: ${team2Players.join(" + ")}`);
        if (otherPlayers.length) parts.push(`other: ${otherPlayers.join(" + ")}`);
        lines.push(`    lineup: ${parts.join(" | ")}`);
      }
    }
  }

  return lines.join("\n");
}
