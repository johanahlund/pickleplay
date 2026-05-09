import { put } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { requireLeagueManager, authErrorResponse, requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_DOCS = 5;
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);

// POST: upload a document (PDF or image) attached to the league.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let user;
  try { user = await requireLeagueManager(id); } catch (e) { return authErrorResponse(e); }

  const count = await prisma.leagueDocument.count({ where: { leagueId: id } });
  if (count >= MAX_DOCS) {
    return NextResponse.json({ error: `Max ${MAX_DOCS} documents per league` }, { status: 400 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: "PDF or JPG/PNG only" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `Max ${MAX_BYTES / (1024 * 1024)}MB` }, { status: 400 });
  }

  const blob = await put(`leagues/${id}/${Date.now()}-${file.name}`, file, {
    access: "public",
    contentType: file.type,
  });

  const doc = await prisma.leagueDocument.create({
    data: {
      leagueId: id,
      url: blob.url,
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      uploadedById: (user as { id: string }).id,
    },
  });
  return NextResponse.json(doc);
}

// GET: list documents (login required).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireAuth(); } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id } = await params;
  const docs = await prisma.leagueDocument.findMany({
    where: { leagueId: id },
    orderBy: { uploadedAt: "asc" },
  });
  return NextResponse.json(docs);
}
