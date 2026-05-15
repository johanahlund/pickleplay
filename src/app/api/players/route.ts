import { prisma } from "@/lib/db";
import { requireAuth, canSeeEmails, getViewerMemberships, canSeeWhatsApp } from "@/lib/auth";
import { NextResponse } from "next/server";

interface AddPlayerCtx {
  clubId?: string | null;
  leagueId?: string | null;
  teamId?: string | null;
  eventId?: string | null;
}

// Returns true if the user is allowed to create a new player record in the
// given context. Permissive on purpose: any "admin" of a relevant
// entity (club / league / team / event) can add. Player rows are cheap and
// the alternative (forcing every captain to nag an app admin) blocks real
// workflows.
async function canAddPlayer(
  user: { id: string; role: string },
  ctx: AddPlayerCtx,
): Promise<boolean> {
  if (user.role === "admin") return true;

  if (ctx.clubId) {
    const member = await prisma.clubMember.findUnique({
      where: { clubId_playerId: { clubId: ctx.clubId, playerId: user.id } },
      select: { role: true },
    });
    if (member && (member.role === "owner" || member.role === "admin")) return true;
  }

  if (ctx.teamId) {
    const team = await prisma.leagueTeam.findUnique({
      where: { id: ctx.teamId },
      select: { captainId: true, viceCaptainId: true, leagueId: true },
    });
    if (team && (team.captainId === user.id || team.viceCaptainId === user.id)) return true;
    // Fall through: team's league might still grant authority below.
    if (team && !ctx.leagueId) ctx = { ...ctx, leagueId: team.leagueId };
  }

  if (ctx.leagueId) {
    const league = await prisma.league.findUnique({
      where: { id: ctx.leagueId },
      select: {
        createdById: true, deputyId: true, clubId: true,
        helpers: { where: { playerId: user.id }, select: { id: true } },
      },
    });
    if (league) {
      if (league.createdById === user.id || league.deputyId === user.id) return true;
      if (league.helpers.length > 0) return true;
      if (league.clubId) {
        const member = await prisma.clubMember.findUnique({
          where: { clubId_playerId: { clubId: league.clubId, playerId: user.id } },
          select: { role: true },
        });
        if (member && (member.role === "owner" || member.role === "admin")) return true;
      }
    }
  }

  if (ctx.eventId) {
    const event = await prisma.event.findUnique({
      where: { id: ctx.eventId },
      select: {
        createdById: true, clubId: true,
        helpers: { where: { playerId: user.id }, select: { id: true } },
        round: { select: { league: { select: { createdById: true, deputyId: true, helpers: { where: { playerId: user.id }, select: { id: true } } } } } },
      },
    });
    if (event) {
      if (event.createdById === user.id) return true;
      if (event.helpers.length > 0) return true;
      if (event.clubId) {
        const member = await prisma.clubMember.findUnique({
          where: { clubId_playerId: { clubId: event.clubId, playerId: user.id } },
          select: { role: true },
        });
        if (member && (member.role === "owner" || member.role === "admin")) return true;
      }
      const league = event.round?.league;
      if (league && (league.createdById === user.id || league.deputyId === user.id || (league.helpers?.length ?? 0) > 0)) return true;
    }
  }

  return false;
}

export async function GET(req: Request) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  // Pagination + search params: with thousands of players we can't ship the
  // whole table on every page load. `q` is a case-insensitive name search;
  // `limit` caps result size (default 100, max 500). The client falls back
  // to client-side filtering for the remaining UI niceties (gender, club).
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const country = (url.searchParams.get("country") || "").trim();
  // App Admin filter: "24h" / "7d" — restrict to players whose accounts
  // were activated (self-registered OR claimed via invite) in that
  // window. Powers the "new users" stats links on /players. Unknown
  // values are ignored.
  const activatedSinceRaw = (url.searchParams.get("activatedSince") || "").trim();
  const activatedSinceMs = activatedSinceRaw === "24h" ? 86_400_000
    : activatedSinceRaw === "7d" ? 7 * 86_400_000
    : null;
  const limitRaw = parseInt(url.searchParams.get("limit") || "100", 10);
  // Hard cap at 5000 — the add-member / add-player pickers want every
  // candidate available locally so they can filter as you type. Realistic
  // datasets stay well below this; the cap is just a safety net.
  const limit = Number.isFinite(limitRaw) ? Math.min(5000, Math.max(1, limitRaw)) : 100;
  const where: {
    status: string;
    name?: { contains: string; mode: "insensitive" };
    country?: string;
    accountActivatedAt?: { gte: Date };
  } = {
    status: "active",
  };
  if (q) where.name = { contains: q, mode: "insensitive" };
  if (country) where.country = country;
  if (activatedSinceMs !== null) {
    where.accountActivatedAt = { gte: new Date(Date.now() - activatedSinceMs) };
  }
  // Wide type — the actual shape is determined by the `select` below.
  let players: Array<Record<string, unknown>>;
  try {
    players = await prisma.player.findMany({
    where,
    // When the "new users" filter is on, sort by most-recently-activated
    // first so the freshly-joined accounts surface immediately.
    orderBy: activatedSinceMs !== null ? { accountActivatedAt: "desc" } : { rating: "desc" },
    take: limit,
    select: {
      id: true,
      name: true,
      emoji: true,
      email: true,
      rating: true,
      wins: true,
      losses: true,
      photoUrl: true,
      gender: true,
      phone: true,
      role: true,
      canCreateLeagues: true,
      canCreateClubs: true,
      country: true,
      duprRating: true,
      whatsappVisibility: true,
      passwordHash: true, // only used to derive hasAccount below
      invitesSent: true,
      lastInvitedAt: true,
      accountActivatedAt: true,
      _count: { select: { matchPlayers: true } },
      clubMembers: {
        select: {
          role: true,
          club: { select: { id: true, name: true, emoji: true } },
        },
      },
      leagueTeamPlayers: {
        select: {
          team: {
            select: {
              id: true,
              name: true,
              league: { select: { id: true, name: true, season: true } },
            },
          },
        },
      },
      eventPlayers: { select: { eventId: true } },
    },
    });
  } catch (err) {
    // Surface a structured error instead of letting the route handler
    // throw — an empty 500 body crashes callers that call `.json()` on
    // the response (the "Unexpected end of JSON input" symptom).
    console.error("GET /api/players failed", err);
    return NextResponse.json(
      { error: "Failed to load players", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  const allowEmail = await canSeeEmails(user.id, user.role);
  const viewerMemberships = await getViewerMemberships(user.id, user.role);

  // Strip passwordHash, add hasAccount flag, optionally strip email, flatten
  // club memberships into a lightweight `clubs` array, plus league-team
  // memberships into a lightweight `leagueTeams` array. WhatsApp number is
  // gated per target via the player's whatsappVisibility setting.
  type ClubMembership = { role: string; club: { id: string; name: string; emoji: string } };
  type TeamPlayer = { team: { id: string; name: string; league: { id: string; name: string; season: string | null } } };
  type EventPlayerRef = { eventId: string };
  const safe = players.map((p) => {
    const { id, passwordHash, email, clubMembers, leagueTeamPlayers, eventPlayers, whatsappVisibility, phone, ...rest } = p as {
      id: string;
      passwordHash: string | null;
      email: string | null;
      clubMembers: ClubMembership[];
      leagueTeamPlayers: TeamPlayer[];
      eventPlayers: EventPlayerRef[];
      whatsappVisibility: string;
      phone: string | null;
      [k: string]: unknown;
    };
    const targetClubIds = clubMembers.map((m) => m.club.id);
    const targetTeamIds = leagueTeamPlayers.map((tp) => tp.team.id);
    const targetEventIds = eventPlayers.map((ep) => ep.eventId);
    const allowWhatsApp = canSeeWhatsApp(viewerMemberships, {
      id,
      whatsappVisibility,
      clubIds: targetClubIds,
      teamIds: targetTeamIds,
      signedUpEventIds: targetEventIds,
    });
    return {
      id,
      ...rest,
      ...(allowEmail ? { email } : {}),
      phone: allowWhatsApp ? phone : null,
      hasAccount: !!passwordHash,
      clubs: clubMembers.map((m) => ({
        id: m.club.id,
        name: m.club.name,
        emoji: m.club.emoji,
        role: m.role,
      })),
      leagueTeams: leagueTeamPlayers.map((tp) => ({
        teamId: tp.team.id,
        teamName: tp.team.name,
        leagueId: tp.team.league.id,
        leagueName: tp.team.league.name,
        season: tp.team.league.season,
      })),
    };
  });

  // Backwards-compatible response: just the array. Pagination signal is
  // carried in headers so existing callers don't need to change. Clients
  // that care can read the X-Total / X-Has-More headers.
  let total: number = safe.length;
  let hasMore = false;
  if (safe.length === limit) {
    total = await prisma.player.count({ where });
    hasMore = total > limit;
  }
  const res = NextResponse.json(safe);
  res.headers.set("X-Total", String(total));
  res.headers.set("X-Has-More", hasMore ? "1" : "0");
  res.headers.set("X-Limit", String(limit));
  return res;
}

export async function POST(req: Request) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { name, emoji, gender, phone, clubId, leagueId, teamId, eventId } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }
  const cleanName = name.trim();

  // Auth: app admin, club owner/admin, league director/deputy/helper,
  // team captain/vice, or event organizer.
  const allowed = await canAddPlayer(user, { clubId, leagueId, teamId, eventId });
  if (!allowed) {
    return NextResponse.json(
      { error: "Not allowed to add players in this context" },
      { status: 403 },
    );
  }

  // Uniqueness check: no two active players with the same name. Case-insensitive
  // comparison so "Johan A" and "johan a" also conflict.
  const existing = await prisma.player.findFirst({
    where: {
      name: { equals: cleanName, mode: "insensitive" },
      status: { not: "voided" },
    },
    select: { id: true, name: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: `A player named "${existing.name}" already exists. Pick a different name or add a suffix (e.g. "${cleanName} 2").` },
      { status: 409 },
    );
  }

  const player = await prisma.player.create({
    data: {
      name: cleanName,
      emoji: emoji || "🏓",
      addedById: user.id,
      ...(gender ? { gender } : {}),
      ...(phone ? { phone: phone.trim() } : {}),
    },
  });

  // Attach to club if requested.
  if (clubId) {
    await prisma.clubMember.create({
      data: { clubId, playerId: player.id, role: "member" },
    });
  }

  // Auto-attach to an event when requested. Mirrors the +Add Player on
  // the event page: creates the EventPlayer row directly so the caller
  // returns to a roster that already includes the new player.
  if (eventId) {
    const ev = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, classes: { select: { id: true, isDefault: true }, orderBy: { isDefault: "desc" } } },
    });
    if (ev) {
      const defaultClassId = ev.classes[0]?.id ?? null;
      await prisma.eventPlayer.create({
        data: {
          eventId: ev.id,
          playerId: player.id,
          classId: defaultClassId,
          status: "registered",
        },
      });
    }
  }

  // Auto-attach to a league team if requested. Mirrors the +Add Player
  // path on the team roster endpoint: creates the LeagueTeamPlayer row
  // AND an "accepted" LeagueParticipationRequest so event sign-up flows
  // can read the player's prefs.
  if (teamId) {
    const team = await prisma.leagueTeam.findUnique({
      where: { id: teamId },
      select: { id: true, leagueId: true },
    });
    if (team) {
      await prisma.$transaction(async (tx) => {
        await tx.leagueTeamPlayer.create({ data: { teamId: team.id, playerId: player.id } });
        await tx.leagueParticipationRequest.upsert({
          where: { leagueId_playerId: { leagueId: team.leagueId, playerId: player.id } },
          create: {
            leagueId: team.leagueId, playerId: player.id,
            preferredTeamId: team.id,
            status: "accepted",
            respondedById: user.id,
            respondedAt: new Date(),
          },
          update: { preferredTeamId: team.id, status: "accepted" },
        });
      });
    }
  }

  return NextResponse.json(player);
}
