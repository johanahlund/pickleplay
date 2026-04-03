import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";
import {
  DEFAULT_COMPETITION_CONFIG,
  CompetitionConfig,
} from "@/lib/competition";

// GET competition state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const event = await prisma.event.findUnique({
    where: { id },
    select: {
      competitionMode: true,
      competitionConfig: true,
      competitionPhase: true,
    },
  });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  return NextResponse.json({
    mode: event.competitionMode,
    config: event.competitionConfig ?? DEFAULT_COMPETITION_CONFIG,
    phase: event.competitionPhase,
  });
}

// POST: enable competition mode or update config
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireEventManager(id);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await req.json();

  if (body.action === "enable") {
    const config = { ...DEFAULT_COMPETITION_CONFIG, ...body.config };
    await prisma.event.update({
      where: { id },
      data: {
        competitionMode: "groups_elimination",
        competitionConfig: config,
        competitionPhase: "groups",
      },
    });
    return NextResponse.json({ ok: true, config });
  }

  if (body.action === "disable") {
    await prisma.event.update({
      where: { id },
      data: {
        competitionMode: null,
        competitionConfig: Prisma.DbNull,
        competitionPhase: null,
      },
    });
    // Clear group labels from pairs
    await prisma.eventPair.updateMany({
      where: { eventId: id },
      data: { groupLabel: null, seed: null },
    });
    // Clear competition metadata from matches
    await prisma.match.updateMany({
      where: { eventId: id },
      data: { groupLabel: null, bracketStage: null, bracketPosition: null, matchFormat: null },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "update_config") {
    const event = await prisma.event.findUnique({
      where: { id },
      select: { competitionConfig: true },
    });
    const current = (event?.competitionConfig as unknown as CompetitionConfig) ?? DEFAULT_COMPETITION_CONFIG;
    const updated = { ...current, ...body.config };
    await prisma.event.update({
      where: { id },
      data: { competitionConfig: updated },
    });
    return NextResponse.json({ ok: true, config: updated });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
