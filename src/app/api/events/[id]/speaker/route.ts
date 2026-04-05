import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: check speaker status + poll for announcements
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const event = await prisma.event.findUnique({
    where: { id },
    select: { speakerUserId: true, speakerUserName: true, pendingAnnouncement: true },
  });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  return NextResponse.json({
    speakerUserId: event.speakerUserId,
    speakerUserName: event.speakerUserName,
    pendingAnnouncement: event.pendingAnnouncement,
  });
}

// POST: set speaker, announce, or clear
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const body = await req.json();

  if (body.action === "set_speaker") {
    await prisma.event.update({
      where: { id },
      data: { speakerUserId: user.id, speakerUserName: user.name },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "clear_speaker") {
    await prisma.event.update({
      where: { id },
      data: { speakerUserId: null, speakerUserName: null, pendingAnnouncement: null },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "announce") {
    if (!body.text) {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }
    await prisma.event.update({
      where: { id },
      data: { pendingAnnouncement: body.text },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "ack") {
    // Speaker device acknowledges it played the announcement
    await prisma.event.update({
      where: { id },
      data: { pendingAnnouncement: null },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
