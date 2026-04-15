import { prisma } from "@/lib/db";
import { requireAuth, requireAdmin, canSeeEmails } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET(
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
    select: { id: true, name: true, email: true, phone: true, gender: true, photoUrl: true, rating: true, emoji: true },
  });
  if (!player) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Strip email unless viewer is the player themselves, admin, or club owner/admin
  const isSelf = user.id === id;
  const allowEmail = isSelf || (await canSeeEmails(user.id, user.role));
  if (!allowEmail) {
    const { email: _e, ...rest } = player;
    void _e;
    return NextResponse.json(rest);
  }
  return NextResponse.json(player);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Only admins can delete players" }, { status: 403 });
  }
  const { id } = await params;
  await prisma.player.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id } = await params;
  // Users can edit themselves, admins can edit anyone
  if (user.id !== id && user.role !== "admin") {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { name, emoji, gender, phone, email } = await req.json();

  const data: { name?: string; emoji?: string; gender?: string | null; phone?: string | null; email?: string | null } = {};
  if (name !== undefined) {
    if (!name?.trim()) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }
    const cleanName = name.trim();
    // Uniqueness check: no other active player with this name (case-insensitive).
    // Skip the check if the name hasn't actually changed.
    const existing = await prisma.player.findFirst({
      where: {
        name: { equals: cleanName, mode: "insensitive" },
        status: { not: "voided" },
        NOT: { id },
      },
      select: { id: true, name: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: `A player named "${existing.name}" already exists. Pick a different name.` },
        { status: 409 },
      );
    }
    data.name = cleanName;
  }
  if (emoji !== undefined) {
    data.emoji = emoji;
  }
  if (gender !== undefined) {
    if (gender !== null && gender !== "M" && gender !== "F") {
      return NextResponse.json({ error: "Gender must be M, F, or null" }, { status: 400 });
    }
    data.gender = gender;
  }
  if (phone !== undefined) {
    data.phone = phone ? phone.trim() : null;
  }
  if (email !== undefined) {
    data.email = email ? email.trim().toLowerCase() : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 }
    );
  }

  const player = await prisma.player.update({
    where: { id },
    data,
  });

  return NextResponse.json(player);
}
