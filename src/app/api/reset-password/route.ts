import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  const { token, password } = await req.json();

  if (!token || !password) {
    return NextResponse.json({ error: "All fields required" }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  // Find the player by reset token
  const player = await prisma.player.findUnique({
    where: { resetToken: token },
  });

  if (!player) {
    return NextResponse.json(
      { error: "Invalid or expired reset link" },
      { status: 404 }
    );
  }

  if (player.status === "voided") {
    return NextResponse.json(
      { error: "This account has been deactivated" },
      { status: 400 }
    );
  }

  // Hash new password and clear reset token
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.player.update({
    where: { id: player.id },
    data: {
      passwordHash,
      resetToken: null, // One-time use
    },
  });

  return NextResponse.json({
    success: true,
    playerName: player.name,
    email: player.email,
  });
}
