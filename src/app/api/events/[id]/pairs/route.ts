import { prisma } from "@/lib/db";
import { requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";
import { generatePairs, PairPlayer, PairMode } from "@/lib/pairgen";

// GET pairs for an event
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pairs = await prisma.eventPair.findMany({
    where: { eventId: id },
    include: {
      player1: { select: { id: true, name: true, emoji: true, rating: true, gender: true } },
      player2: { select: { id: true, name: true, emoji: true, rating: true, gender: true } },
    },
  });
  return NextResponse.json(pairs);
}

// POST: generate pairs automatically or create a single manual pair
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

  const cls = await prisma.eventClass.findFirst({ where: { eventId: id, isDefault: true } });

  // Manual pair creation: { player1Id, player2Id }
  if (body.player1Id && body.player2Id) {
    // Check neither player is already in a pair
    const existing = await prisma.eventPair.findFirst({
      where: {
        eventId: id,
        OR: [
          { player1Id: { in: [body.player1Id, body.player2Id] } },
          { player2Id: { in: [body.player1Id, body.player2Id] } },
        ],
      },
    });
    if (existing) {
      return NextResponse.json({ error: "One of these players is already in a pair" }, { status: 400 });
    }

    const pair = await prisma.eventPair.create({
      data: { eventId: id, classId: cls?.id, player1Id: body.player1Id, player2Id: body.player2Id },
      include: {
        player1: { select: { id: true, name: true, emoji: true, rating: true, gender: true } },
        player2: { select: { id: true, name: true, emoji: true, rating: true, gender: true } },
      },
    });
    return NextResponse.json(pair);
  }

  // Auto-generate: { mode: "rating"|"level"|"random", preferMixed?: boolean, clearExisting?: boolean }
  const mode: PairMode = body.mode || "rating";
  const preferMixed = !!body.preferMixed;

  // Clear existing pairs
  await prisma.eventPair.deleteMany({ where: { eventId: id } });

  // Get active players with their event-level skill levels
  const eventPlayers = await prisma.eventPlayer.findMany({
    where: {
      eventId: id,
      status: { in: ["registered", "checked_in"] },
    },
    include: { player: true },
  });

  const players: PairPlayer[] = eventPlayers.map((ep) => ({
    id: ep.player.id,
    name: ep.player.name,
    rating: ep.player.rating,
    gender: ep.player.gender,
    skillLevel: ep.skillLevel,
  }));

  const generated = generatePairs(players, { mode, preferMixed });

  // Save pairs
  for (const pair of generated) {
    await prisma.eventPair.create({
      data: { eventId: id, classId: cls?.id, player1Id: pair.player1Id, player2Id: pair.player2Id },
    });
  }

  // Return all pairs
  const pairs = await prisma.eventPair.findMany({
    where: { eventId: id },
    include: {
      player1: { select: { id: true, name: true, emoji: true, rating: true, gender: true } },
      player2: { select: { id: true, name: true, emoji: true, rating: true, gender: true } },
    },
  });

  return NextResponse.json(pairs);
}

// DELETE: clear all pairs or remove a single pair
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireEventManager(id);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  if (body.pairId) {
    // Find the pair to get player IDs for cancelling the request
    const pair = await prisma.eventPair.findUnique({ where: { id: body.pairId } });
    if (pair) {
      await prisma.eventPair.delete({ where: { id: body.pairId } });
      // Also cancel any accepted pair request for these players
      await prisma.pairRequest.updateMany({
        where: {
          eventId: id, status: "accepted",
          OR: [
            { requesterId: pair.player1Id, requestedId: pair.player2Id },
            { requesterId: pair.player2Id, requestedId: pair.player1Id },
          ],
        },
        data: { status: "cancelled" },
      });
    }
  } else {
    await prisma.eventPair.deleteMany({ where: { eventId: id } });
    // Cancel all accepted pair requests for this event
    await prisma.pairRequest.updateMany({
      where: { eventId: id, status: "accepted" },
      data: { status: "cancelled" },
    });
  }

  return NextResponse.json({ ok: true });
}
