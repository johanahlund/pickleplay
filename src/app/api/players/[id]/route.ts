import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { NextResponse } from "next/server";

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
  const { id } = await params;
  const { name, emoji, gender, phone } = await req.json();

  const data: { name?: string; emoji?: string; gender?: string | null; phone?: string | null } = {};
  if (name !== undefined) {
    if (!name?.trim()) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }
    data.name = name.trim();
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
