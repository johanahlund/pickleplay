import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { requireLeagueManager, authErrorResponse } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; teamId: string }> }
) {
  const { id, teamId } = await params;
  try { await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  // Verify team belongs to league
  const team = await prisma.leagueTeam.findUnique({
    where: { id: teamId },
    select: { leagueId: true, logoUrl: true, photoUrl: true },
  });
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  if (team.leagueId !== id) {
    return NextResponse.json({ error: "Team does not belong to this league" }, { status: 403 });
  }

  const formData = await req.formData();
  const type = formData.get("type") as string; // "logo" or "photo"
  const file = formData.get("file") as File | null;

  if (!file || !["logo", "photo"].includes(type)) {
    return NextResponse.json({ error: "file and type (logo/photo) required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Must be an image" }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Max 5MB" }, { status: 400 });
  }

  // Delete old image
  const oldUrl = type === "logo" ? team.logoUrl : team.photoUrl;
  if (oldUrl) {
    try { await del(oldUrl); } catch { /* ignore */ }
  }

  const ext = file.type.split("/")[1] || "jpg";
  const blob = await put(`league-teams/${teamId}-${type}-${Date.now()}.${ext}`, file, {
    access: "public",
  });

  await prisma.leagueTeam.update({
    where: { id: teamId },
    data: type === "logo" ? { logoUrl: blob.url } : { photoUrl: blob.url },
  });

  return NextResponse.json({ url: blob.url, type });
}
