import { prisma } from "./db";

export async function sendNotification(
  playerId: string,
  type: string,
  title: string,
  body?: string,
  linkUrl?: string
) {
  await prisma.notification.create({
    data: { playerId, type, title, body, linkUrl },
  });
}
