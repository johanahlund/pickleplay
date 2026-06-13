"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./Icon";
import { useCurrentEvent } from "./useCurrentEvent";

const HIDDEN_PREFIXES = ["/signin", "/register", "/claim", "/reset"];

/**
 * Bottom-right floating button that jumps to the user's "current event" (manual
 * pin or auto-detected — see useCurrentEvent). Hidden when there's no current
 * event, on auth pages, or when you're already on that event's page. Sits above
 * the bottom-nav + footer-logo stack.
 */
export function CurrentEventFab() {
  const pathname = usePathname();
  const { event } = useCurrentEvent();

  if (!event) return null;
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  if (pathname === `/events/${event.id}`) return null;

  const isSetup = event.status === "setup" || event.status === "draft";
  return (
    <Link
      href={`/events/${event.id}`}
      aria-label={`Current event: ${event.name}`}
      className="fixed right-4 z-40 bottom-[calc(7rem+env(safe-area-inset-bottom))]"
    >
      <div
        className={`flex items-center gap-1.5 pl-2.5 pr-3 py-2 rounded-full shadow-lg text-white active:scale-95 transition-transform ${
          isSetup ? "bg-blue-600" : "bg-green-600 animate-pulse-slow"
        }`}
      >
        <Icon name={isSetup ? "edit" : "pickleball"} size={18} color="white" />
        <span className="text-xs font-bold truncate max-w-[130px]">{event.name}</span>
      </div>
    </Link>
  );
}
