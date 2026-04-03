import { prisma } from "./db";

/**
 * Get the default (or specified) class for an event.
 * For single-class events, returns the only class.
 * For multi-class events, returns the class matching classId, or the default.
 */
export async function getEventClass(eventId: string, classId?: string | null) {
  if (classId) {
    return prisma.eventClass.findUnique({ where: { id: classId } });
  }
  return prisma.eventClass.findFirst({
    where: { eventId, isDefault: true },
  });
}
