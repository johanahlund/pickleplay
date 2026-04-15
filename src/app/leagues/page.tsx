"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

interface League {
  id: string;
  name: string;
  description: string | null;
  season: string | null;
  status: string;
  createdAt: string;
  club?: { id: string; name: string; emoji: string; logoUrl?: string | null } | null;
  teams: { id: string; name: string; club?: { name: string; emoji: string; logoUrl?: string | null } | null; _count: { players: number } }[];
  _count: { rounds: number; categories: number };
}

interface MyClub { myRole: string }

export default function LeaguesPage() {
  const { data: session } = useSession();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [canCreate, setCanCreate] = useState(false);
  const userRole = (session?.user as { role?: string } | undefined)?.role;

  useEffect(() => {
    fetch("/api/leagues").then((r) => r.json()).then((data) => { setLeagues(data || []); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!session?.user) { setCanCreate(false); return; }
    if (userRole === "admin") { setCanCreate(true); return; }
    fetch("/api/clubs").then((r) => r.ok ? r.json() : []).then((clubs: MyClub[]) => {
      setCanCreate(clubs.some((c) => c.myRole === "owner" || c.myRole === "admin"));
    });
  }, [session, userRole]);

  if (loading) return <div className="text-center py-12 text-muted">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Leagues</h2>
        {canCreate && (
          <Link href="/leagues/new" className="bg-action text-white px-4 py-2 rounded-lg font-medium text-sm">+ New League</Link>
        )}
      </div>

      {leagues.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted text-sm">No leagues yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {leagues.map((league) => (
            <Link key={league.id} href={`/leagues/${league.id}`}
              className="block bg-card rounded-xl border border-border p-4 active:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{league.name}</h3>
                  {league.season && <span className="text-xs text-muted">{league.season}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    league.status === "active" ? "bg-green-100 text-green-700" :
                    league.status === "completed" ? "bg-gray-100 text-muted" :
                    "bg-blue-100 text-blue-700"
                  }`}>{league.status}</span>
                  <span className="text-xl text-muted">›</span>
                </div>
              </div>
              {league.club && (
                <div className="flex items-center gap-1.5 mt-1 text-xs text-muted">
                  <span>{league.club.emoji}</span>
                  <span className="font-medium text-foreground">{league.club.name}</span>
                </div>
              )}
              {league.description && <p className="text-sm text-muted mt-1">{league.description}</p>}
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs text-muted">{league.teams.length} teams</span>
                <span className="text-xs text-muted">{league._count.rounds} rounds</span>
                <span className="text-xs text-muted">{league._count.categories} categories</span>
              </div>
              {league.teams.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {league.teams.map((t) => (
                    <span key={t.id} className="text-[10px] bg-gray-100 px-2 py-0.5 rounded-full font-medium">
                      {t.club?.emoji || "🏟️"} {t.name} ({t._count.players})
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
