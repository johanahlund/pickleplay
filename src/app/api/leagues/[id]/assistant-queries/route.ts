import { prisma } from "@/lib/db";
import { requireLeagueManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// GET: list assistant chat logs for this league. League managers and
// app admins only. Newest first; capped at 500 rows per request.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 500);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

  const [total, rows] = await Promise.all([
    prisma.leagueAssistantQuery.count({ where: { leagueId: id } }),
    prisma.leagueAssistantQuery.findMany({
      where: { leagueId: id },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        player: { select: { id: true, name: true, photoUrl: true } },
      },
    }),
  ]);

  return NextResponse.json({ total, rows });
}
