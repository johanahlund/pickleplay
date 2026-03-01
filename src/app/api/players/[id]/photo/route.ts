import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Users can only update their own photo (or admin can update anyone's)
  if (user.id !== id && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("photo") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }

  // Validate: image only, max 5MB
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Must be an image" }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Max 5MB" }, { status: 400 });
  }

  // Delete old photo if exists
  const existing = await prisma.player.findUnique({ where: { id } });
  if (existing?.photoUrl) {
    try {
      await del(existing.photoUrl);
    } catch {
      // ignore delete errors
    }
  }

  // Upload to Vercel Blob
  const ext = file.type.split("/")[1] || "jpg";
  const blob = await put(`photos/${id}-${Date.now()}.${ext}`, file, {
    access: "public",
  });

  // Update player record
  await prisma.player.update({
    where: { id },
    data: { photoUrl: blob.url },
  });

  return NextResponse.json({ photoUrl: blob.url });
}
