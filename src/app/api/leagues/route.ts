import { prisma } from "@/lib/db";
import { requireAuth, requireClubOwner, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: list all leagues (login required)
export async function GET() {
  try { await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const leagues = await prisma.league.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      club: { select: { id: true, name: true, emoji: true, logoUrl: true } },
      teams: { include: { club: { select: { id: true, name: true, emoji: true, logoUrl: true } }, _count: { select: { players: true } } } },
      _count: { select: { rounds: true, categories: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json(leagues);
}

// POST: create a new league — must be owner/admin of the organizing club (or app admin)
export async function POST(req: Request) {
  const { name, description, season, config, categories, clubId } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
  if (!clubId || typeof clubId !== "string") {
    return NextResponse.json({ error: "Organizing club is required" }, { status: 400 });
  }

  let user;
  try { user = await requireClubOwner(clubId); } catch (e) { return authErrorResponse(e); }

  const league = await prisma.league.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      season: season?.trim() || null,
      config: config || { maxRoster: 14, maxPointsPerMatchDay: 3 },
      clubId,
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
