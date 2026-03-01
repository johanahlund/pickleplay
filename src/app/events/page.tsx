"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Event {
  id: string;
  name: string;
  date: string;
  status: string;
  numCourts: number;
  format: string;
  players: { player: { name: string; emoji: string } }[];
  _count: { matches: number };
}

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/events")
      .then((r) => r.json())
      .then((data) => {
        setEvents(data);
        setLoading(false);
      });
  }, []);

  const deleteEvent = async (id: string) => {
    if (!confirm("Delete this event and all its matches?")) return;
    await fetch(`/api/events/${id}`, { method: "DELETE" });
    setEvents((prev) => prev.filter((e) => e.id !== id));
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "setup":
        return "bg-blue-100 text-blue-700";
      case "active":
        return "bg-green-100 text-green-700";
      case "completed":
        return "bg-gray-100 text-gray-600";
      default:
        return "bg-gray-100 text-gray-600";
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Events</h2>
        <Link
          href="/events/new"
          className="bg-primary text-white px-4 py-2 rounded-lg font-medium text-sm active:bg-primary-dark transition-colors"
        >
          + New
        </Link>
      </div>

      {events.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-3">🏸</div>
          <p className="text-muted">No events yet.</p>
          <Link href="/events/new" className="text-primary font-medium mt-2 inline-block">
            Create your first event
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="bg-card rounded-xl border border-border overflow-hidden">
              <Link href={`/events/${event.id}`} className="block p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">{event.name}</h3>
                    <p className="text-sm text-muted mt-0.5">
                      {new Date(event.date).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      at{" "}
                      {new Date(event.date).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      &middot; {event.numCourts} court
                      {event.numCourts !== 1 ? "s" : ""} &middot; {event.format}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-full ${statusBadge(
                      event.status
                    )}`}
                  >
                    {event.status}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-2">
                  <div className="flex -space-x-1">
                    {event.players.slice(0, 6).map((ep, i) => (
                      <span key={i} className="text-lg">
                        {ep.player.emoji}
                      </span>
                    ))}
                  </div>
                  <span className="text-sm text-muted ml-1">
                    {event.players.length} players &middot; {event._count.matches} matches
                  </span>
                </div>
              </Link>
              <div className="border-t border-border px-4 py-2 flex justify-end">
                <button
                  onClick={() => deleteEvent(event.id)}
                  className="text-danger text-sm px-2 py-1 rounded hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
