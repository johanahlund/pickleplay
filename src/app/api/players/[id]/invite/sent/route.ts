import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { canInvite } from "@/lib/playerInviteAuth";

/**
 * Record that the caller sent (or claims to have sent) an invite to
 * this player. Increments `invitesSent` and bumps `lastInvitedAt`.
 * Does NOT generate a claim token — pair this with the regular
 * `/invite` route when you also need a link.
 *
 * The icon in the UI colour-codes by `lastInvitedAt` age (gray =
 * never, amber = ≤7d, faded = >7d), so the colour shifts as soon as
 * this endpoint returns.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id } = await params;

  const player = await prisma.player.findUnique({
    where: { id },
    select: { id: true, status: true, email: true, passwordHash: true },
  });
  if (!player || player.status === "voided") {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  const ok = await canInvite(user.id, user.role, id);
  if (!ok) {
    return NextResponse.json({ error: "Not authorized to invite this player" }, { status: 403 });
  }

  if (player.email && player.passwordHash) {
    return NextResponse.json({ error: "Player already has an account" }, { status: 400 });
  }

  const updated = await prisma.player.update({
    where: { id },
    data: {
      invitesSent: { increment: 1 },
      lastInvitedAt: new Date(),
    },
    select: { invitesSent: true, lastInvitedAt: true },
  });

  return NextResponse.json(updated);
}
