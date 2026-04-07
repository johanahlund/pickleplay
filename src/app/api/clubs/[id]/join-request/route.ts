import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: list join requests (club admin/owner only)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const membership = await prisma.clubMember.findUnique({
    where: { clubId_playerId: { clubId: id, playerId: user.id } },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const requests = await prisma.clubJoinRequest.findMany({
    where: { clubId: id },
    include: { player: { select: { id: true, name: true, emoji: true, gender: true, rating: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(requests);
}

// POST: create a join request (any logged-in user)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  // Check if already a member
  const existing = await prisma.clubMember.findUnique({
    where: { clubId_playerId: { clubId: id, playerId: user.id } },
  });
  if (existing) {
    return NextResponse.json({ error: "Already a member" }, { status: 400 });
  }

  // Check if already has a pending request
  const pendingReq = await prisma.clubJoinRequest.findUnique({
    where: { clubId_playerId: { clubId: id, playerId: user.id } },
  });
  if (pendingReq?.status === "pending") {
    return NextResponse.json({ error: "Request already pending" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));

  // Upsert (handles declined → re-request)
  const request = await prisma.clubJoinRequest.upsert({
    where: { clubId_playerId: { clubId: id, playerId: user.id } },
    create: { clubId: id, playerId: user.id, message: body.message || null },
    update: { status: "pending", message: body.message || null },
  });

  return NextResponse.json(request);
}

// PATCH: accept or decline a request (club admin/owner)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const membership = await prisma.clubMember.findUnique({
    where: { clubId_playerId: { clubId: id, playerId: user.id } },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await req.json();
  const { requestId, action } = body;

  if (!requestId || !["accept", "decline"].includes(action)) {
    return NextResponse.json({ error: "requestId and action (accept/decline) required" }, { status: 400 });
  }

  const joinReq = await prisma.clubJoinRequest.findUnique({ where: { id: requestId } });
  if (!joinReq || joinReq.clubId !== id) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  if (action === "accept") {
    // Add as member
    await prisma.clubMember.create({
      data: { clubId: id, playerId: joinReq.playerId, role: "member" },
    });
    await prisma.clubJoinRequest.update({
      where: { id: requestId },
      data: { status: "accepted" },
    });
    return NextResponse.json({ ok: true, status: "accepted" });
  }

  if (action === "decline") {
    await prisma.clubJoinRequest.update({
      where: { id: requestId },
      data: { status: "declined" },
    });
    return NextResponse.json({ ok: true, status: "declined" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
