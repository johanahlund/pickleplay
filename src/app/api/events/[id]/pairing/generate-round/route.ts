import { prisma } from "@/lib/db";
import { requireEventManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";
import { generateRound } from "@/lib/solver/generateRound";
import { autoAssignSkillLevel } from "@/lib/solver/skillAssign";
import type {
  MatchHistoryEntry,
  PairLock,
  PairingSettings,
  SkillLevel,
  SolverInput,
  SolverPlayer,
} from "@/lib/solver/types";

/**
 * POST /api/events/[id]/pairing/generate-round
 *
 * Unified round / next-match endpoint for the new solver. Works for both
 * round-based AND continuous play modes via the same surface:
 *
 *   - Round-based: no in-progress matches exist, `includeCourts` is empty,
 *     the solver generates as many matches as the event has courts.
 *   - Continuous: some courts are already playing. Pass `includeCourts: []`
 *     to generate matches only for idle players (possibly just 1 court).
 *     Pass `includeCourts: [3]` to say "I'm willing to wait for court 3 to
 *     finish — include its players in the pool AND reserve that court for
 *     a new match".
 *
 * Also supports preview: `preview: true` runs the solver and returns what
 * would be generated WITHOUT writing any Match rows. Used by the pairing
 * page to show a live preview as the organizer toggles court inclusion.
 *
 * Body:
 *   {
 *     classId: string,
 *     settings?: PairingSettings,
 *     locks?: PairLock[],
 *     includeCourts?: number[],
 *     preview?: boolean,
 *   }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireEventManager(id); } catch (e) { return authErrorResponse(e); }

  try {
  const body = await req.json().catch(() => null) as {
    classId?: string;
    settings?: Partial<PairingSettings>;
    locks?: { playerAId: string; playerBId: string }[];
    includeCourts?: number[];
    preview?: boolean;
    commitRound?: { court: number; team1: { player1Id: string; player2Id: string }; team2: { player1Id: string; player2Id: string } }[];
    individual?: boolean; // true = "Next Match" (round 0, not part of a round)
  } | null;
  if (!body?.classId) {
    return NextResponse.json({ error: "classId required" }, { status: 400 });
  }

  const eventClass = await prisma.eventClass.findUnique({
    where: { id: body.classId },
    select: {
      eventId: true,
      format: true,
      pairingSettings: true,
      event: { select: { numCourts: true } },
      players: {
        where: { status: { in: ["checked_in"] } },
        select: {
          id: true,
          playerId: true,
          skillLevel: true,
          autoSkillLevel: true,
          matchCountOffset: true,
          status: true,
          player: {
            select: {
              id: true,
              name: true,
              gender: true,
              rating: true,
              globalRating: true,
              duprRating: true,
            },
          },
        },
      },
    },
  });

  if (!eventClass) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }
  if (eventClass.eventId !== id) {
    return NextResponse.json({ error: "Class does not belong to this event" }, { status: 403 });
  }
  if (eventClass.format !== "doubles" && eventClass.format !== "singles") {
    return NextResponse.json(
      { error: `Unknown format "${eventClass.format}"` },
      { status: 400 },
    );
  }

  // ── Fast path: commit a preview directly (no solver re-run) ─────────
  if (body.commitRound && body.commitRound.length > 0) {
    const allMatches = await prisma.match.findMany({
      where: { eventId: id },
      select: { round: true },
      orderBy: { round: "desc" },
      take: 1,
    });
    const nextRound = body.individual ? 0 : (allMatches[0]?.round ?? 0) + 1;
    const isSingles = eventClass.format === "singles";
    const createdMatchIds: string[] = [];
    for (const m of body.commitRound) {
      const team1 = [{ playerId: m.team1.player1Id, team: 1, score: 0 }];
      if (!isSingles) team1.push({ playerId: m.team1.player2Id, team: 1, score: 0 });
      const team2 = [{ playerId: m.team2.player1Id, team: 2, score: 0 }];
      if (!isSingles) team2.push({ playerId: m.team2.player2Id, team: 2, score: 0 });
      const match = await prisma.match.create({
        data: {
          eventId: id,
          classId: body.classId,
          round: nextRound,
          courtNum: m.court,
          status: "pending",
          players: { create: [...team1, ...team2] },
        },
        select: { id: true },
      });
      createdMatchIds.push(match.id);
    }
    return NextResponse.json({ round: nextRound, matches: createdMatchIds });
  }

  const settings = normalizeSettings(
    body.settings ||
      (eventClass.pairingSettings as Partial<PairingSettings> | null) ||
      {},
  );

  // ── Load all matches (history for variety + match counts AND current
  //    busy-court state for continuous mode) ──────────────────────────────
  const allMatches = await prisma.match.findMany({
    where: { eventId: id, classId: body.classId },
    select: {
      id: true,
      round: true,
      courtNum: true,
      status: true,
      players: { select: { playerId: true, team: true, score: true } },
    },
    orderBy: [{ round: "asc" }, { courtNum: "asc" }],
  });

  // Partition: history = completed; active = pending/in_progress
  const history: MatchHistoryEntry[] = [];
  const activeMatches: typeof allMatches = [];
  const counts = new Map<string, number>();
  const lastPlayedRound = new Map<string, number>();
  let maxRound = 0;

  for (const m of allMatches) {
    maxRound = Math.max(maxRound, m.round);
    if (m.status === "completed") {
      const t1Players = m.players.filter((p) => p.team === 1);
      const t2Players = m.players.filter((p) => p.team === 2);
      const t1 = t1Players.map((p) => p.playerId);
      const t2 = t2Players.map((p) => p.playerId);
      const t1Score = t1Players.reduce((s, p) => s + p.score, 0);
      const t2Score = t2Players.reduce((s, p) => s + p.score, 0);
      const winningTeam: 1 | 2 | null =
        t1Score > t2Score ? 1 : t2Score > t1Score ? 2 : null;
      if (t1.length === 2 && t2.length === 2) {
        history.push({
          round: m.round,
          courtNum: m.courtNum,
          team1Ids: [t1[0], t1[1]],
          team2Ids: [t2[0], t2[1]],
          winningTeam,
        });
      }
      for (const p of m.players) {
        counts.set(p.playerId, (counts.get(p.playerId) || 0) + 1);
        lastPlayedRound.set(p.playerId, Math.max(lastPlayedRound.get(p.playerId) || 0, m.round));
      }
    } else if (m.status === "active" || m.status === "paused") {
      activeMatches.push(m);
    }
    // Count pending matches for variety tracking (not yet played, but scheduled)
    if (m.status === "pending") {
      const t1 = m.players.filter((p) => p.team === 1).map((p) => p.playerId);
      const t2 = m.players.filter((p) => p.team === 2).map((p) => p.playerId);
      if (t1.length === 2 && t2.length === 2) {
        history.push({ round: m.round, courtNum: m.courtNum, team1Ids: [t1[0], t1[1]], team2Ids: [t2[0], t2[1]], winningTeam: null });
      }
      for (const p of m.players) {
        counts.set(p.playerId, (counts.get(p.playerId) || 0) + 1);
      }
    }
  }

  // ── Figure out which courts are currently busy and which players are
  //    tied up in their in-progress matches ─────────────────────────────
  const busyCourts = new Set<number>(activeMatches.map((m) => m.courtNum));
  const playersByCourt = new Map<number, Set<string>>();
  for (const m of activeMatches) {
    const set = playersByCourt.get(m.courtNum) || new Set<string>();
    for (const p of m.players) set.add(p.playerId);
    playersByCourt.set(m.courtNum, set);
  }

  const includeCourts = Array.isArray(body.includeCourts) ? body.includeCourts : [];
  const includedCourtSet = new Set<number>(includeCourts);

  // Busy players = players in active matches that the user is NOT including.
  const busyPlayerIds = new Set<string>();
  for (const [court, ids] of playersByCourt.entries()) {
    if (!includedCourtSet.has(court)) {
      for (const id of ids) busyPlayerIds.add(id);
    }
  }

  // Target court count = idle courts + user-included courts, capped at numCourts.
  const totalCourts = eventClass.event.numCourts;
  const idleCourtCount = totalCourts - busyCourts.size;
  const courtsToFill = Math.min(totalCourts, idleCourtCount + includedCourtSet.size);

  // ── Calculate global average match count from ALL players in the class
  //    (not just idle ones) so the solver's fairness scoring isn't skewed
  //    by which players happen to be on court right now. ──────────────────
  const allPlayerCounts = eventClass.players.map(
    (ep) => (counts.get(ep.playerId) || 0) + (ep.matchCountOffset || 0),
  );
  const globalAvg =
    allPlayerCounts.length > 0
      ? allPlayerCounts.reduce((s, c) => s + c, 0) / allPlayerCounts.length
      : 0;

  // ── Build the solver player list ──────────────────────────────────────
  // Only include players who are NOT currently playing on a court we're not
  // waiting for. Paused players are also excluded.
  const solverPlayers: SolverPlayer[] = eventClass.players
    .filter((ep) => !busyPlayerIds.has(ep.playerId))
    .map((ep) => {
      const level: SkillLevel =
        (ep.skillLevel as SkillLevel | null) ??
        (ep.autoSkillLevel as SkillLevel | null) ??
        autoAssignSkillLevel({
          duprRating: ep.player.duprRating,
          globalRating: ep.player.globalRating,
        });
      const last = lastPlayedRound.get(ep.playerId) || 0;
      return {
        id: ep.playerId,
        name: ep.player.name,
        skillLevel: level,
        gender: normalizeGender(ep.player.gender),
        matchCount: (counts.get(ep.playerId) || 0) + (ep.matchCountOffset || 0),
        roundsSinceLastPlayed: last > 0 ? maxRound - last : 0,
        paused: ep.status === "paused",
      };
    });

  // Locks (from body override or DB).
  let locks: PairLock[];
  if (body.locks) {
    locks = body.locks.map((l) => ({ playerAId: l.playerAId, playerBId: l.playerBId }));
  } else {
    const dbLocks = await prisma.eventPairLock.findMany({
      where: { eventId: id, classId: body.classId },
      select: { playerAId: true, playerBId: true },
    });
    locks = dbLocks.map((l) => ({ playerAId: l.playerAId, playerBId: l.playerBId }));
  }

  // For fixed-teams mode, pull the pre-formed EventPair rows.
  let fixedTeams: { player1Id: string; player2Id: string }[] | undefined;
  if (settings.teams === "fixed") {
    const pairs = await prisma.eventPair.findMany({
      where: { eventId: id, classId: body.classId },
      select: { player1Id: true, player2Id: true },
    });
    fixedTeams = pairs.map((p) => ({ player1Id: p.player1Id, player2Id: p.player2Id }));
  }

  const input: SolverInput = {
    players: solverPlayers,
    numCourts: courtsToFill,
    format: eventClass.format === "singles" ? "singles" : "doubles",
    settings,
    history,
    locks,
    fixedTeams,
    globalAvgMatchCount: globalAvg,
  };

  const result = generateRound(input);

  // Resolve player names for the response so the UI can render previews
  // without another roundtrip.
  const playerNameMap = new Map(
    eventClass.players.map((ep) => [ep.playerId, ep.player.name]),
  );
  const isSinglesPreview = eventClass.format === "singles";
  const enrichedRound = result.round.map((m) => {
    const team1Players = [
      { id: m.team1.player1Id, name: playerNameMap.get(m.team1.player1Id) || "?" },
    ];
    if (!isSinglesPreview) {
      team1Players.push({ id: m.team1.player2Id, name: playerNameMap.get(m.team1.player2Id) || "?" });
    }
    const team2Players = [
      { id: m.team2.player1Id, name: playerNameMap.get(m.team2.player1Id) || "?" },
    ];
    if (!isSinglesPreview) {
      team2Players.push({ id: m.team2.player2Id, name: playerNameMap.get(m.team2.player2Id) || "?" });
    }
    return { ...m, team1Players, team2Players };
  });

  // Preview mode: return what would happen, don't write anything.
  if (body.preview) {
    return NextResponse.json({
      preview: true,
      round: enrichedRound,
      cost: result.cost,
      violations: result.violations,
      sittingOut: result.sittingOut,
      idleCourtCount,
      busyCourts: [...busyCourts],
      includedCourts: [...includedCourtSet],
      availablePlayerCount: solverPlayers.length,
      courtsToFill,
    });
  }

  if (result.round.length === 0) {
    return NextResponse.json({
      error: "No matches could be generated",
      violations: result.violations,
      sittingOut: result.sittingOut,
    }, { status: 400 });
  }

  // ── Commit: persist the matches ───────────────────────────────────────
  // Assign freshly-generated matches to courts in this order:
  //   1. Idle courts first (their court numbers)
  //   2. Then included-but-currently-busy courts (solver returns court 1..N
  //      internally, so we need to remap to real court numbers)
  const allCourtNums = Array.from({ length: totalCourts }, (_, i) => i + 1);
  const idleCourtNums = allCourtNums.filter((n) => !busyCourts.has(n));
  const targetCourtNums = [...idleCourtNums, ...includeCourts.filter((n) => !idleCourtNums.includes(n))];

  const nextRound = body.individual ? 0 : maxRound + 1;
  const createdMatchIds: string[] = [];

  // For included courts we need to remove the OLD in-progress match first
  // (the user said "court 3 will finish soon, treat it as done"). Safest:
  // delete the pending match so only the new one exists.
  for (const court of includeCourts) {
    const oldMatch = activeMatches.find((m) => m.courtNum === court);
    if (oldMatch && oldMatch.status === "pending") {
      await prisma.match.delete({ where: { id: oldMatch.id } });
    }
  }

  const isSingles = eventClass.format === "singles";
  for (let i = 0; i < result.round.length; i++) {
    const m = result.round[i];
    const courtNum = targetCourtNums[i] || m.court;
    // Singles uses a sentinel where player2Id === player1Id. Write only
    // one player per team for singles; two per team for doubles.
    const team1 = [{ playerId: m.team1.player1Id, team: 1, score: 0 }];
    if (!isSingles) {
      team1.push({ playerId: m.team1.player2Id, team: 1, score: 0 });
    }
    const team2 = [{ playerId: m.team2.player1Id, team: 2, score: 0 }];
    if (!isSingles) {
      team2.push({ playerId: m.team2.player2Id, team: 2, score: 0 });
    }
    const match = await prisma.match.create({
      data: {
        eventId: id,
        classId: body.classId,
        round: nextRound,
        courtNum,
        status: "pending",
        players: {
          create: [...team1, ...team2],
        },
      },
      select: { id: true },
    });
    createdMatchIds.push(match.id);
  }

  return NextResponse.json({
    round: nextRound,
    matches: createdMatchIds,
    cost: result.cost,
    violations: result.violations,
    sittingOut: result.sittingOut,
  });
  } catch (error) {
    console.error("generate-round error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function normalizeGender(g: string | null | undefined): "M" | "F" | null {
  if (g === "M" || g === "F") return g;
  return null;
}

function normalizeSettings(s: Partial<PairingSettings>): PairingSettings {
  const inf = (v: unknown): number => {
    if (v === null || v === undefined) return Infinity;
    if (v === "inf" || v === "infinity") return Infinity;
    return Number(v);
  };
  return {
    base: (s.base as PairingSettings["base"]) ?? "random",
    teams: (s.teams as PairingSettings["teams"]) ?? "rotating",
    gender: (s.gender as PairingSettings["gender"]) ?? "random",
    skillWindow: inf(s.skillWindow),
    matchCountWindow: inf(s.matchCountWindow),
    varietyWindow: inf(s.varietyWindow),
    maxWaitWindow: s.maxWaitWindow === undefined ? Infinity : inf(s.maxWaitWindow),
  };
}
