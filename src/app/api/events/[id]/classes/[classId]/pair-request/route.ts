import { prisma } from "@/lib/db";
import { requireAuth, requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";
import { sendNotification } from "@/lib/notify";

// GET: list pair requests for a class
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; classId: string }> }
) {
  const { id, classId } = await params;
  const requests = await prisma.pairRequest.findMany({
    where: { eventId: id, classId },
    orderBy: { createdAt: "desc" },
  });

  // Enrich with player names
  const playerIds = new Set<string>();
  requests.forEach((r) => { playerIds.add(r.requesterId); playerIds.add(r.requestedId); });
  const players = await prisma.player.findMany({
    where: { id: { in: [...playerIds] } },
    select: { id: true, name: true, emoji: true },
  });
  const playerMap = Object.fromEntries(players.map((p) => [p.id, p]));

  const enriched = requests.map((r) => ({
    ...r,
    requester: playerMap[r.requesterId],
    requested: playerMap[r.requestedId],
  }));

  return NextResponse.json(enriched);
}

// POST: create a pair request, accept/decline, or force-pair (admin)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; classId: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { id, classId } = await params;
  const body = await req.json();

  // ── Request a partner ──
  if (body.action === "request") {
    const { partnerId } = body;
    if (!partnerId) return NextResponse.json({ error: "partnerId required" }, { status: 400 });

    // Check both players are in this class
    const requesterInClass = await prisma.eventPlayer.findFirst({ where: { eventId: id, classId, playerId: user.id } });
    const requestedInClass = await prisma.eventPlayer.findFirst({ where: { eventId: id, classId, playerId: partnerId } });
    if (!requesterInClass) return NextResponse.json({ error: "You are not in this class" }, { status: 400 });
    if (!requestedInClass) return NextResponse.json({ error: "Partner is not in this class" }, { status: 400 });

    // Check requester doesn't already have an accepted pair
    const existingAccepted = await prisma.pairRequest.findFirst({
      where: {
        eventId: id, classId, status: "accepted",
        OR: [{ requesterId: user.id }, { requestedId: user.id }],
      },
    });
    if (existingAccepted) return NextResponse.json({ error: "You already have a confirmed partner" }, { status: 400 });

    // Cancel any existing pending request from this user
    await prisma.pairRequest.updateMany({
      where: { eventId: id, classId, requesterId: user.id, status: "pending" },
      data: { status: "cancelled" },
    });

    // Create new request
    const request = await prisma.pairRequest.create({
      data: { eventId: id, classId, requesterId: user.id, requestedId: partnerId },
    });

    // Notify the requested player
    await sendNotification(
      partnerId,
      "pair_request",
      `${user.name} wants to partner with you`,
      "Tap to view and accept or decline",
      `/events/${id}`
    );

    return NextResponse.json(request);
  }

  // ── Accept a request ──
  if (body.action === "accept") {
    const { requestId } = body;
    if (!requestId) return NextResponse.json({ error: "requestId required" }, { status: 400 });

    const request = await prisma.pairRequest.findUnique({ where: { id: requestId } });
    if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    if (request.requestedId !== user.id) return NextResponse.json({ error: "Not your request to accept" }, { status: 403 });
    if (request.status !== "pending") return NextResponse.json({ error: "Request is not pending" }, { status: 400 });

    // Check accepter doesn't already have an accepted pair
    const existingAccepted = await prisma.pairRequest.findFirst({
      where: {
        eventId: id, classId, status: "accepted",
        OR: [{ requesterId: user.id }, { requestedId: user.id }],
      },
    });
    if (existingAccepted) return NextResponse.json({ error: "You already have a confirmed partner" }, { status: 400 });

    // Accept this request
    await prisma.pairRequest.update({ where: { id: requestId }, data: { status: "accepted" } });

    // Decline all other pending requests involving either player
    await prisma.pairRequest.updateMany({
      where: {
        eventId: id, classId, status: "pending", id: { not: requestId },
        OR: [
          { requesterId: request.requesterId },
          { requestedId: request.requesterId },
          { requesterId: request.requestedId },
          { requestedId: request.requestedId },
        ],
      },
      data: { status: "declined" },
    });

    // Create the actual EventPair
    await prisma.eventPair.create({
      data: {
        eventId: id,
        classId,
        player1Id: request.requesterId,
        player2Id: request.requestedId,
      },
    });

    // Notify the requester
    await sendNotification(
      request.requesterId,
      "pair_accepted",
      `${user.name} accepted your partner request!`,
      "You're now paired for this class",
      `/events/${id}`
    );

    return NextResponse.json({ ok: true, status: "accepted" });
  }

  // ── Decline a request ──
  if (body.action === "decline") {
    const { requestId } = body;
    const request = await prisma.pairRequest.findUnique({ where: { id: requestId } });
    if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    if (request.requestedId !== user.id) return NextResponse.json({ error: "Not your request to decline" }, { status: 403 });

    await prisma.pairRequest.update({ where: { id: requestId }, data: { status: "declined" } });
    return NextResponse.json({ ok: true, status: "declined" });
  }

  // ── Cancel own request ──
  if (body.action === "cancel") {
    const { requestId } = body;
    const request = await prisma.pairRequest.findUnique({ where: { id: requestId } });
    if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
    if (request.requesterId !== user.id) return NextResponse.json({ error: "Not your request to cancel" }, { status: 403 });

    await prisma.pairRequest.update({ where: { id: requestId }, data: { status: "cancelled" } });
    return NextResponse.json({ ok: true, status: "cancelled" });
  }

  // ── Unpair: player breaks their own accepted pair ──
  if (body.action === "unpair") {
    const { requestId } = body;
    const request = await prisma.pairRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== "accepted") return NextResponse.json({ error: "No active pair found" }, { status: 404 });
    if (request.requesterId !== user.id && request.requestedId !== user.id) {
      return NextResponse.json({ error: "Not your pair" }, { status: 403 });
    }

    // Check not in a match
    const inMatch = await prisma.matchPlayer.findFirst({
      where: { playerId: user.id, match: { eventId: id, classId } },
    });
    if (inMatch) {
      return NextResponse.json({ error: "Cannot unpair: you are assigned to a match" }, { status: 400 });
    }

    // Cancel the pair request
    await prisma.pairRequest.update({ where: { id: requestId }, data: { status: "cancelled" } });

    // Delete the EventPair
    await prisma.eventPair.deleteMany({
      where: {
        eventId: id, classId,
        OR: [
          { player1Id: request.requesterId, player2Id: request.requestedId },
          { player1Id: request.requestedId, player2Id: request.requesterId },
        ],
      },
    });

    return NextResponse.json({ ok: true, status: "unpaired" });
  }

  // ── Force pair (admin/manager) ──
  if (body.action === "force_pair") {
    try { await requireEventManager(id); } catch {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    const { player1Id, player2Id } = body;
    if (!player1Id || !player2Id) return NextResponse.json({ error: "player1Id and player2Id required" }, { status: 400 });

    // Cancel any pending requests involving these players
    await prisma.pairRequest.updateMany({
      where: {
        eventId: id, classId, status: "pending",
        OR: [
          { requesterId: player1Id }, { requestedId: player1Id },
          { requesterId: player2Id }, { requestedId: player2Id },
        ],
      },
      data: { status: "cancelled" },
    });

    // Create accepted request record
    await prisma.pairRequest.create({
      data: { eventId: id, classId, requesterId: player1Id, requestedId: player2Id, status: "accepted" },
    });

    // Create the pair
    await prisma.eventPair.create({
      data: { eventId: id, classId, player1Id, player2Id },
    });

    return NextResponse.json({ ok: true, status: "force_paired" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
