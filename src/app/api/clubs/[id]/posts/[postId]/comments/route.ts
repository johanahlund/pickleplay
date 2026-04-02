import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { NextResponse } from "next/server";

// Add a comment to a post
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const { id, postId } = await params;
  const { content } = await req.json();

  if (!content?.trim()) {
    return NextResponse.json({ error: "Content required" }, { status: 400 });
  }

  // Verify user is a club member
  const membership = await prisma.clubMember.findUnique({
    where: { clubId_playerId: { clubId: id, playerId: user.id } },
  });
  if (!membership && user.role !== "admin") {
    return NextResponse.json({ error: "Must be a club member to comment" }, { status: 403 });
  }

  const comment = await prisma.clubComment.create({
    data: {
      postId,
      authorId: user.id,
      content: content.trim(),
    },
    include: {
      author: { select: { id: true, name: true, emoji: true, photoUrl: true } },
    },
  });

  return NextResponse.json(comment);
}
