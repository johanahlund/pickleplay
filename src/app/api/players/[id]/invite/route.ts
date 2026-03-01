import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const player = await prisma.player.findUnique({ where: { id } });
  if (!player || player.status === "voided") {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  // If already has email + password, they're already registered
  if (player.email && player.passwordHash) {
    return NextResponse.json(
      { error: "Player already has an account" },
      { status: 400 }
    );
  }

  // Generate or reuse existing invite token
  let token = player.inviteToken;
  if (!token) {
    token = randomBytes(24).toString("hex");
    await prisma.player.update({
      where: { id },
      data: { inviteToken: token },
    });
  }

  return NextResponse.json({ token });
}
