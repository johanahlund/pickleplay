"use client";

import { useEffect, useState } from "react";
import { readPin, setCurrentEventPin } from "./useCurrentEvent";

/**
 * "Set as current" toggle for an event page — manually pins this event as the
 * current one (the bottom-right FAB then jumps here). Manual pin wins over the
 * auto-detection until cleared.
 */
export function PinCurrentEventButton({ eventId }: { eventId: string }) {
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const read = () => setPinned(readPin() === eventId);
    read();
    window.addEventListener("currentEventPin:changed", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("currentEventPin:changed", read);
      window.removeEventListener("storage", read);
    };
  }, [eventId]);

  return (
    <button
      type="button"
      onClick={() => setCurrentEventPin(pinned ? null : eventId)}
      aria-pressed={pinned}
      className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1 ${
        pinned ? "bg-action text-white border-action" : "text-action border-action/30 hover:bg-action/5"
      }`}
    >
      📌 {pinned ? "Current event" : "Set as current"}
    </button>
  );
}
