import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

const ADMIN_EMAILS = ["johan@ahlund.me"];

export async function POST(req: Request) {
  const { name, email, password, emoji } = await req.json();

  if (!name?.trim() || !email?.trim() || !password || password.length < 6) {
    return NextResponse.json(
      { error: "Name, email, and password (min 6 chars) required" },
      { status: 400 }
    );
  }

  const normalizedEmail = email.toLowerCase().trim();

  const existing = await prisma.player.findUnique({
    where: { email: normalizedEmail },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Email already in use" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const role = ADMIN_EMAILS.includes(normalizedEmail) ? "admin" : "user";

  const player = await prisma.player.create({
    data: {
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      emoji: emoji || "🏓",
      role,
    },
  });

  return NextResponse.json({ id: player.id, name: player.name, role: player.role });
}
