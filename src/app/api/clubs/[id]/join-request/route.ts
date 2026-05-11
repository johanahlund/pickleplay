import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: list join requests (club owner/admin OR app admin).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  if (user.role !== "admin") {
    const membership = await prisma.clubMember.findUnique({
      where: { clubId_playerId: { clubId: id, playerId: user.id } },
    });
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
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

// DELETE: cancel the caller's own pending join request.
// Useful when a user changes their mind before a club admin acts on it.
// Only deletes when status is still "pending" — already-accepted requests
// are no-ops (the membership row would be removed via /members instead);
// declined requests can be deleted to allow re-requesting from a clean
// slate, but the POST handler also handles re-request via upsert.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const existing = await prisma.clubJoinRequest.findUnique({
    where: { clubId_playerId: { clubId: id, playerId: user.id } },
    select: { id: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ ok: true, deleted: false });
  }
  if (existing.status === "accepted") {
    return NextResponse.json(
      { error: "Already accepted — leave the club from your membership instead" },
      { status: 400 },
    );
  }

  await prisma.clubJoinRequest.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true, deleted: true });
}

// PATCH: accept or decline a request (club owner/admin OR app admin).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  if (user.role !== "admin") {
    const membership = await prisma.clubMember.findUnique({
      where: { clubId_playerId: { clubId: id, playerId: user.id } },
    });
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
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
    // Notify the requester via the bell-icon inbox.
    const club = await prisma.club.findUnique({ where: { id }, select: { name: true } });
    await prisma.notification.create({
      data: {
        playerId: joinReq.playerId,
        type: "club_join_accepted",
        title: `Welcome to ${club?.name ?? "the club"}`,
        body: "Your join request was accepted — you're now a member.",
        linkUrl: `/clubs/${id}`,
      },
    });
    return NextResponse.json({ ok: true, status: "accepted" });
  }

  if (action === "decline") {
    await prisma.clubJoinRequest.update({
      where: { id: requestId },
      data: { status: "declined" },
    });
    const club = await prisma.club.findUnique({ where: { id }, select: { name: true } });
    await prisma.notification.create({
      data: {
        playerId: joinReq.playerId,
        type: "club_join_declined",
        title: `Join request declined`,
        body: `${club?.name ?? "The club"} declined your join request. You can request again later.`,
        linkUrl: `/clubs/${id}`,
      },
    });
    return NextResponse.json({ ok: true, status: "declined" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
