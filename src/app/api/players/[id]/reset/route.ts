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

  // Player must have an account to reset password
  if (!player.email || !player.passwordHash) {
    return NextResponse.json(
      { error: "Player doesn't have an account yet" },
      { status: 400 }
    );
  }

  // Generate a new reset token (always fresh, invalidates any previous one)
  const token = randomBytes(24).toString("hex");
  await prisma.player.update({
    where: { id },
    data: { resetToken: token },
  });

  return NextResponse.json({ token });
}
