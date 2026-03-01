import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.player.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { name, emoji } = await req.json();

  const data: { name?: string; emoji?: string } = {};
  if (name !== undefined) {
    if (!name?.trim()) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }
    data.name = name.trim();
  }
  if (emoji !== undefined) {
    data.emoji = emoji;
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
