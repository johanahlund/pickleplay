import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  const { token, email, password } = await req.json();

  if (!token || !email?.trim() || !password) {
    return NextResponse.json({ error: "All fields required" }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Check if email is already taken by another player
  const existingEmail = await prisma.player.findUnique({
    where: { email: normalizedEmail },
  });
  if (existingEmail) {
    return NextResponse.json(
      { error: "Email already in use" },
      { status: 400 }
    );
  }

  // Find the player by invite token
  const player = await prisma.player.findUnique({
    where: { inviteToken: token },
  });
  if (!player) {
    return NextResponse.json(
      { error: "Invalid or expired invite link" },
      { status: 404 }
    );
  }

  if (player.status === "voided") {
    return NextResponse.json(
      { error: "This account has been deactivated" },
      { status: 400 }
    );
  }

  // If already claimed
  if (player.email && player.passwordHash) {
    return NextResponse.json(
      { error: "Account already claimed" },
      { status: 400 }
    );
  }

  // Hash password and update player
  const passwordHash = await bcrypt.hash(password, 12);

  // Determine role (admin emails get admin role)
  const ADMIN_EMAILS = ["johan@ahlund.me"];
  const role = ADMIN_EMAILS.includes(normalizedEmail) ? "admin" : "user";

  await prisma.player.update({
    where: { id: player.id },
    data: {
      email: normalizedEmail,
      passwordHash,
      role,
      inviteToken: null, // Clear the token — one-time use
    },
  });

  return NextResponse.json({ success: true, playerName: player.name });
}
