import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: all pending join requests the current user has sent across all
// clubs. Used by the clubs landing page to render a "Pending requests"
// section so users don't have to scroll Find Clubs to find what they
// applied to — and so the "Requested" pill survives page reloads.
export async function GET() {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const requests = await prisma.clubJoinRequest.findMany({
    where: { playerId: user.id, status: "pending" },
    include: {
      club: {
        select: {
          id: true, name: true, emoji: true, logoUrl: true, coverUrl: true,
          city: true, country: true,
          _count: { select: { members: true, events: true } },
          members: {
            select: {
              role: true,
              player: { select: { id: true, name: true, gender: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    requests.map((r) => ({
      requestId: r.id,
      createdAt: r.createdAt,
      club: r.club,
    })),
  );
}
