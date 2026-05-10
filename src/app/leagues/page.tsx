"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { setPreview } from "@/lib/entityPreview";
import { leagueDisplayLabel } from "@/lib/statusDisplay";
import { leagueStatusBadgeClass } from "@/lib/statusBadge";
import { ClubBadge } from "@/components/ClubBadge";
import { frameClass } from "@/components/Card";

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

export default function LeaguesPage() {
  const { data: session } = useSession();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const userRole = (session?.user as { role?: string } | undefined)?.role;
  const canCreateLeagues = !!(session?.user as { canCreateLeagues?: boolean } | undefined)?.canCreateLeagues;
  const canCreate = userRole === "admin" || canCreateLeagues;

  useEffect(() => {
    fetch("/api/leagues").then((r) => r.json()).then((data) => { setLeagues(data || []); setLoading(false); });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Leagues</h2>
        {canCreate && (
          <Link href="/leagues/new" className="bg-action text-white px-4 py-2 rounded-lg font-medium text-sm">+ League</Link>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-5 h-5 border-2 border-action border-t-transparent rounded-full animate-spin" />
        </div>
      ) : leagues.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted text-sm">No leagues yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {leagues.map((league) => (
            <Link key={league.id} href={`/leagues/${league.id}`}
              onClick={() => setPreview("league", league.id, {
                id: league.id, name: league.name, description: league.description,
                season: league.season, status: league.status, club: league.club ?? null,
              })}
              className={`block ${frameClass} p-4 active:bg-gray-50 transition-colors`}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{league.name}</h3>
                  {league.season && <span className="text-xs text-muted">{league.season}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${leagueStatusBadgeClass(league.status)}`}>{leagueDisplayLabel(league.status)}</span>
                  <span className="text-xl text-muted">›</span>
                </div>
              </div>
              {league.club && (
                <div className="flex items-center gap-1.5 mt-1 text-xs text-muted">
                  <ClubBadge logoUrl={league.club.logoUrl} size={14} />
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
                  {[...league.teams].sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
                    <span key={t.id} className="text-[10px] bg-gray-100 px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1">
                      <ClubBadge logoUrl={t.club?.logoUrl} size={12} />
                      {t.name} ({t._count.players})
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
