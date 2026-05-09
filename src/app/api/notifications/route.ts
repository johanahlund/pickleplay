import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: unread notifications for the current user
export async function GET() {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const notifications = await prisma.notification.findMany({
    where: { playerId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json(notifications);
}

// POST: mark notifications as read
export async function POST(req: Request) {
  let user;
  try { user = await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { action, notificationId } = await req.json();

  if (action === "read_all") {
    await prisma.notification.updateMany({
      where: { playerId: user.id, read: false },
      data: { read: true },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "read" && notificationId) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "delete" && notificationId) {
    // Only let the user delete their own alerts.
    const n = await prisma.notification.findUnique({ where: { id: notificationId }, select: { playerId: true } });
    if (!n) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (n.playerId !== user.id) return NextResponse.json({ error: "Not yours" }, { status: 403 });
    await prisma.notification.delete({ where: { id: notificationId } });
    return NextResponse.json({ ok: true });
  }

  if (action === "delete_read") {
    await prisma.notification.deleteMany({ where: { playerId: user.id, read: true } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
