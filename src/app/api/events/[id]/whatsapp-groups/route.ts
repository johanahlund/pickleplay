import { prisma } from "@/lib/db";
import { requireEventManager } from "@/lib/auth";
import { NextResponse } from "next/server";

// Get groups linked to this event
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const links = await prisma.eventWhatsAppGroup.findMany({
    where: { eventId: id },
    include: { whatsappGroup: true },
  });
  return NextResponse.json(links.map((l) => l.whatsappGroup));
}

// Link a group to this event
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireEventManager(id);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { whatsappGroupId } = await req.json();
  if (!whatsappGroupId) {
    return NextResponse.json({ error: "whatsappGroupId required" }, { status: 400 });
  }

  const existing = await prisma.eventWhatsAppGroup.findUnique({
    where: { eventId_whatsappGroupId: { eventId: id, whatsappGroupId } },
  });
  if (existing) {
    return NextResponse.json({ error: "Already linked" }, { status: 400 });
  }

  await prisma.eventWhatsAppGroup.create({
    data: { eventId: id, whatsappGroupId },
  });
  return NextResponse.json({ ok: true });
}

// Unlink a group from this event
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireEventManager(id);
  } catch {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { whatsappGroupId } = await req.json();
  await prisma.eventWhatsAppGroup.deleteMany({
    where: { eventId: id, whatsappGroupId },
  });
  return NextResponse.json({ ok: true });
}
