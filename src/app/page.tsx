"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function Home() {
  const [stats, setStats] = useState({ players: 0, events: 0 });

  useEffect(() => {
    Promise.all([
      fetch("/api/players").then((r) => r.json()),
      fetch("/api/events").then((r) => r.json()),
    ]).then(([players, events]) => {
      setStats({
        players: Array.isArray(players) ? players.length : 0,
        events: Array.isArray(events) ? events.length : 0,
      });
    });
  }, []);

  return (
    <div className="space-y-6">
      <div className="text-center py-6">
        <div className="text-6xl mb-3">🏓</div>
        <h2 className="text-2xl font-bold">Welcome to PicklePlay</h2>
        <p className="text-muted mt-1">Organize games, track scores, climb the ranks!</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card rounded-xl border border-border p-4 text-center">
          <div className="text-3xl font-bold text-primary">{stats.players}</div>
          <div className="text-sm text-muted mt-1">Players</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4 text-center">
          <div className="text-3xl font-bold text-primary">{stats.events}</div>
          <div className="text-sm text-muted mt-1">Events</div>
        </div>
      </div>

      <div className="space-y-3">
        <Link
          href="/events/new"
          className="block w-full bg-primary text-white text-center py-3 rounded-xl font-semibold text-lg shadow-md active:bg-primary-dark transition-colors"
        >
          + New Event
        </Link>
        <Link
          href="/players"
          className="block w-full bg-card text-foreground text-center py-3 rounded-xl font-semibold border border-border active:bg-gray-50 transition-colors"
        >
          Manage Players
        </Link>
        <Link
          href="/leaderboard"
          className="block w-full bg-card text-foreground text-center py-3 rounded-xl font-semibold border border-border active:bg-gray-50 transition-colors"
        >
          View Rankings
        </Link>
      </div>
    </div>
  );
}
