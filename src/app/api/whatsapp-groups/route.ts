import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const groups = await prisma.whatsAppGroup.findMany({
    orderBy: { name: "asc" },
  });
  return NextResponse.json(groups);
}

export async function POST(req: Request) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { name } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }

  const group = await prisma.whatsAppGroup.create({
    data: { name: name.trim() },
  });
  return NextResponse.json(group);
}

export async function DELETE(req: Request) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await prisma.whatsAppGroup.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
