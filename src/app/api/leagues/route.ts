import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: list all leagues (or leagues user is part of)
export async function GET() {
  const leagues = await prisma.league.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      teams: { include: { club: { select: { id: true, name: true, emoji: true, logoUrl: true } }, _count: { select: { players: true } } } },
      _count: { select: { rounds: true, categories: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json(leagues);
}

// POST: create a new league
export async function POST(req: Request) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { name, description, season, config, categories } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const league = await prisma.league.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      season: season?.trim() || null,
      config: config || { maxRoster: 14, maxPointsPerMatchDay: 3 },
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
