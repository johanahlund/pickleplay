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
  numSets: number;
  scoringType: string;
  timedMinutes: number | null;
  pairingMode: string;
  players: { player: { name: string; emoji: string } }[];
  _count: { matches: number };
}

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<string>("all");

  useEffect(() => {
    fetch("/api/events")
      .then((r) => r.json())
      .then((data) => {
        setEvents(data);
        setLoading(false);
      });
  }, []);

  const deleteEvent = async (id: string) => {
    if (!confirm("Are you sure you want to delete this event and all its matches?")) return;
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

  const matchesDateFilter = (dateStr: string, filter: string) => {
    if (filter === "all") return true;
    const eventDate = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (filter === "today") {
      return eventDate >= today && eventDate < new Date(today.getTime() + 86400000);
    }
    if (filter === "this_week") {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
      return eventDate >= weekStart && eventDate < weekEnd;
    }
    if (filter === "this_month") {
      return eventDate.getMonth() === now.getMonth() && eventDate.getFullYear() === now.getFullYear();
    }
    return true;
  };

  const filteredEvents = events
    .filter((e) => e.name.toLowerCase().includes(searchQuery.toLowerCase()) && matchesDateFilter(e.date, dateFilter))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

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

      <div className="space-y-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search events..."
          className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
        />
        <div className="flex gap-1.5">
          {[
            { value: "all", label: "All" },
            { value: "today", label: "Today" },
            { value: "this_week", label: "This Week" },
            { value: "this_month", label: "This Month" },
          ].map((f) => (
            <button
              key={f.value}
              onClick={() => setDateFilter(f.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                dateFilter === f.value
                  ? "bg-primary text-white"
                  : "bg-gray-100 text-muted hover:bg-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filteredEvents.length === 0 && events.length > 0 ? (
        <div className="text-center py-8">
          <p className="text-muted">No events match your search.</p>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-3">🏸</div>
          <p className="text-muted">No events yet.</p>
          <Link href="/events/new" className="text-primary font-medium mt-2 inline-block">
            Create your first event
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEvents.map((event) => (
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
                    <div className="flex flex-wrap gap-1 mt-1">
                      <span className="text-[10px] bg-gray-100 text-muted px-1.5 py-0.5 rounded">
                        {event.numSets === 1 ? "1 set" : `Bo${event.numSets}`}
                      </span>
                      <span className="text-[10px] bg-gray-100 text-muted px-1.5 py-0.5 rounded">
                        {event.scoringType === "normal_11" ? "11" : event.scoringType === "normal_15" ? "15" : event.scoringType === "rally_21" ? "R21" : "Time"}
                      </span>
                      {event.pairingMode !== "random" && (
                        <span className="text-[10px] bg-gray-100 text-muted px-1.5 py-0.5 rounded">
                          {event.pairingMode === "skill_balanced" ? "Skill" : event.pairingMode === "mixed_gender" ? "Mixed" : event.pairingMode === "skill_mixed_gender" ? "Skill+Mix" : event.pairingMode === "king_of_court" ? "King" : event.pairingMode === "manual" ? "Manual" : "Swiss"}
                        </span>
                      )}
                    </div>
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
