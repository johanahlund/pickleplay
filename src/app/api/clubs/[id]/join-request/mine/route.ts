import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const request = await prisma.clubJoinRequest.findFirst({
    where: { clubId: id, playerId: user.id, status: "pending" },
  });

  return NextResponse.json({ pending: !!request });
}
