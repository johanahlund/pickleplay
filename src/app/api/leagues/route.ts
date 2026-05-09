import { prisma } from "@/lib/db";
import { requireAuth, requireClubOwner, requireLeagueCreator, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: list all leagues (login required)
// Participant-only leagues are filtered out for users who aren't participants.
export async function GET() {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const leagues = await prisma.league.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      club: { select: { id: true, name: true, emoji: true, logoUrl: true } },
      teams: {
        include: {
          club: { select: { id: true, name: true, emoji: true, logoUrl: true } },
          _count: { select: { players: true } },
          players: { select: { playerId: true } },
        },
      },
      _count: { select: { rounds: true, categories: true } },
      createdBy: { select: { id: true, name: true } },
      deputy: { select: { id: true } },
      helpers: { select: { playerId: true } },
    },
  });

  const isAppAdmin = user.role === "admin";
  const visible = leagues.filter((l) => {
    const isOrganizer = isAppAdmin || l.createdBy?.id === user.id || l.deputy?.id === user.id;
    // Leagues in "setup" are visible only to director/deputy/app admin.
    if (l.status === "setup" && !isOrganizer) return false;
    if (l.visibility !== "participants") return true;
    if (isOrganizer) return true;
    if (l.helpers.some((h) => h.playerId === user.id)) return true;
    return l.teams.some((t) =>
      t.captainId === user.id || t.viceCaptainId === user.id ||
      t.players.some((tp) => tp.playerId === user.id),
    );
  });
  // Strip the inner playerId arrays we only used for the visibility check
  const out = visible.map((l) => {
    const { helpers: _h, deputy: _d, teams, ...rest } = l;
    void _h; void _d;
    return {
      ...rest,
      teams: teams.map((t) => {
        const { players: _p, captainId: _c, viceCaptainId: _v, ...trest } = t;
        void _p; void _c; void _v;
        return trest;
      }),
    };
  });

  return NextResponse.json(out);
}

// POST: create a new league — requires canCreateLeagues (granted by app admin).
// If clubId is provided, the user must also be owner/admin of that club.
export async function POST(req: Request) {
  const { name, description, season, config, categories, clubId } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  let user;
  try { user = await requireLeagueCreator(); } catch (e) { return authErrorResponse(e); }

  if (clubId) {
    if (typeof clubId !== "string") {
      return NextResponse.json({ error: "Invalid clubId" }, { status: 400 });
    }
    try { await requireClubOwner(clubId); } catch (e) { return authErrorResponse(e); }
  }

  const league = await prisma.league.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      season: season?.trim() || null,
      config: config || { maxRoster: 14, maxPointsPerMatchDay: 3 },
      clubId: clubId || null,
      createdById: user.id,
      ...(categories?.length ? {
        categories: {
          create: categories.map((c: { name: string; format?: string; gender?: string; scoringFormat?: string; winBy?: string }, i: number) => ({
            name: c.name,
            format: c.format || "doubles",
            gender: c.gender || "open",
            scoringFormat: c.scoringFormat || "3x15",
            winBy: c.winBy || "2",
            sortOrder: i,
          })),
        },
      } : {}),
    },
    include: { categories: true },
  });

  return NextResponse.json(league);
}
