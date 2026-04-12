import { prisma } from "@/lib/db";
import { requireLeagueManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

// POST: add a team to the league
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const { name, clubId, captainId, viceCaptainId, slogan } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Team name required" }, { status: 400 });

  const team = await prisma.leagueTeam.create({
    data: {
      leagueId: id,
      name: name.trim(),
      clubId: clubId || null,
      captainId: captainId || null,
      viceCaptainId: viceCaptainId || null,
      slogan: slogan?.trim() || null,
      // Copy club logo if linked
      ...(clubId ? { logoUrl: (await prisma.club.findUnique({ where: { id: clubId }, select: { logoUrl: true } }))?.logoUrl } : {}),
    },
    include: {
      club: { select: { id: true, name: true, emoji: true, logoUrl: true } },
      _count: { select: { players: true } },
    },
  });
  return NextResponse.json(team);
}
