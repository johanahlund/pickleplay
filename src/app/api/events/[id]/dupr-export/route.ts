import { prisma } from "@/lib/db";
import { requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";
import { generateDuprCsv, toDuprScoringFormat } from "@/lib/dupr-export";
import { getEventClass } from "@/lib/eventClass";

// GET: download DUPR CSV for completed matches
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try { await requireEventManager(id); } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      matches: {
        where: { status: "completed" },
        include: { players: { include: { player: true } } },
      },
    },
  });

  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const cls = await getEventClass(id);
  const format = (cls?.format || "doubles") as string;
  const scoringType = cls?.scoringType || "normal_11";

  const rows = event.matches.map((match) => {
    const team1 = match.players.filter((p) => p.team === 1);
    const team2 = match.players.filter((p) => p.team === 2);
    const t1Score = team1[0]?.score ?? 0;
    const t2Score = team2[0]?.score ?? 0;

    return {
      matchDate: match.createdAt.toISOString().split("T")[0],
      matchType: (format === "singles" ? "SINGLES" : "DOUBLES") as "SINGLES" | "DOUBLES",
      scoringFormat: toDuprScoringFormat(scoringType),
      team1Player1Name: team1[0]?.player.name || "",
      team1Player1DuprId: team1[0]?.player.duprId || "",
      team1Player2Name: team1[1]?.player.name || "",
      team1Player2DuprId: team1[1]?.player.duprId || "",
      team2Player1Name: team2[0]?.player.name || "",
      team2Player1DuprId: team2[0]?.player.duprId || "",
      team2Player2Name: team2[1]?.player.name || "",
      team2Player2DuprId: team2[1]?.player.duprId || "",
      team1Score: t1Score,
      team2Score: t2Score,
    };
  });

  const csv = generateDuprCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="dupr-results-${event.name.replace(/\s+/g, "-")}.csv"`,
    },
  });
}
