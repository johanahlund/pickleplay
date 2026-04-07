import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;

  // Must be club admin/owner
  const membership = await prisma.clubMember.findUnique({
    where: { clubId_playerId: { clubId: id, playerId: user.id } },
  });
  if (!membership || (!["owner", "admin"].includes(membership.role) && user.role !== "admin")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const formData = await req.formData();
  const type = formData.get("type") as string; // "logo" or "cover"
  const file = formData.get("file") as File | null;

  if (!file || !["logo", "cover"].includes(type)) {
    return NextResponse.json({ error: "file and type (logo/cover) required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Must be an image" }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Max 5MB" }, { status: 400 });
  }

  // Delete old image if exists
  const club = await prisma.club.findUnique({ where: { id } });
  const oldUrl = type === "logo" ? club?.logoUrl : club?.coverUrl;
  if (oldUrl) {
    try { await del(oldUrl); } catch { /* ignore */ }
  }

  // Upload to Vercel Blob
  const ext = file.type.split("/")[1] || "jpg";
  const blob = await put(`clubs/${id}-${type}-${Date.now()}.${ext}`, file, {
    access: "public",
  });

  // Update club
  await prisma.club.update({
    where: { id },
    data: type === "logo" ? { logoUrl: blob.url } : { coverUrl: blob.url },
  });

  return NextResponse.json({ url: blob.url, type });
}
