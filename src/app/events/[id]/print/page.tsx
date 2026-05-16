"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { shortFormatLabel } from "@/lib/inviteShare";

/**
 * Print-friendly schedule view. Fetched and rendered as a static
 * page (no nav, no controls), then `window.print()` fires on mount.
 * The browser's "Save as PDF" produces the deliverable file.
 *
 * Layout — top to bottom:
 *   header (league · round · host vs visitor · date · venue)
 *   organizer comments (if any)
 *   per-court column grid with match cards
 *
 * Everything else (filter pills, action clusters, scorer overlay)
 * is intentionally absent — the print should look like a printable
 * draw sheet, not a screenshot.
 */
type PrintMatch = {
  id: string;
  slotNumber: number;
  category: { id: string; name: string };
  kind: "principal" | "league" | "extra";
  scheduledAt: string | null;
  courtNum: number | null;
  scoringFormatOverride?: string | null;
  winByOverride?: string | null;
  team1Id: string;
  team2Id: string;
  gamePlayers: { playerId: string; team: number | null }[];
};

type PrintEvent = {
  id: string;
  name: string;
  date: string;
  comments?: string | null;
  numCourts: number;
  hostTeamId: string | null;
  club?: { name: string; shortName?: string | null } | null;
  round?: {
    roundNumber: number;
    name?: string | null;
    league: {
      id: string;
      name: string;
      shortName?: string | null;
      categories: { id: string; name: string; scoringFormat: string | null; winBy: string | null }[];
      teams: { id: string; name: string; players: { playerId: string; player: { name: string } }[] }[];
    };
  } | null;
  leagueTeams?: { teamId: string; team: { id: string; name: string } }[];
  leagueGames?: PrintMatch[];
};

function timeHHMM(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function EventPrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [event, setEvent] = useState<PrintEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const r = await fetch(`/api/events/${id}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        setEvent(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!event) return;
    // Tiny delay so the layout has time to settle (avatars / fonts).
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, [event]);

  if (error) return <div style={{ padding: 24, fontFamily: "system-ui" }}>{error}</div>;
  if (!event) return <div style={{ padding: 24, fontFamily: "system-ui" }}>Loading…</div>;

  const teams = event.round?.league.teams || [];
  const playerById = new Map<string, string>();
  for (const t of teams) {
    for (const tp of t.players) playerById.set(tp.playerId, tp.player.name);
  }
  const teamShort = (tid: string): string => {
    const t = (event.leagueTeams || []).find((lt) => lt.teamId === tid);
    return t?.team.name ?? "?";
  };
  const categoryById = new Map(
    (event.round?.league.categories || []).map((c) => [c.id, c]),
  );

  // Bucket league games by court. Sort each court by scheduledAt.
  const allGames = (event.leagueGames || []).slice().sort((a, b) => {
    const at = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
    const bt = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
    return at - bt;
  });
  const buckets: Record<string, PrintMatch[]> = { unassigned: [] };
  for (let n = 1; n <= event.numCourts; n++) buckets[String(n)] = [];
  for (const g of allGames) {
    const key = g.courtNum == null ? "unassigned" : String(g.courtNum);
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(g);
  }

  const dateStr = new Date(event.date).toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const teamPair = (event.leagueTeams || []).map((lt) => lt.team.name).join(" vs ");
  const hostTeamName = event.hostTeamId
    ? (event.leagueTeams || []).find((lt) => lt.teamId === event.hostTeamId)?.team.name
    : null;
  const visitorTeamName = event.hostTeamId
    ? (event.leagueTeams || []).find((lt) => lt.teamId !== event.hostTeamId)?.team.name
    : null;
  const roundLabel = event.round?.name || (event.round ? `Round ${event.round.roundNumber}` : null);
  const venue = event.club?.shortName?.trim() || event.club?.name || null;
  const leagueName = event.round?.league.shortName || event.round?.league.name || null;

  return (
    <>
      <style jsx global>{`
        @page { size: A4; margin: 12mm; }
        html, body { background: #fff; color: #111; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", padding: "16px", maxWidth: 1100, margin: "0 auto" }}>
        {/* Top-right helper for screen viewers — hidden on print */}
        <div className="no-print" style={{ textAlign: "right", marginBottom: 8 }}>
          <button onClick={() => window.print()} style={{ padding: "6px 14px", fontSize: 13, border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer" }}>
            🖨️ Print / Save as PDF
          </button>
        </div>

        {/* Header */}
        <header style={{ borderBottom: "2px solid #15803d", paddingBottom: 12, marginBottom: 16 }}>
          {leagueName && (
            <div style={{ fontSize: 13, color: "#15803d", fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>
              {leagueName}{roundLabel ? ` · ${roundLabel}` : ""}
            </div>
          )}
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: "4px 0 6px", color: "#0f172a" }}>
            {hostTeamName && visitorTeamName ? `${hostTeamName} hosting ${visitorTeamName}` : teamPair || event.name}
          </h1>
          <div style={{ fontSize: 14, color: "#475569" }}>
            {dateStr}{venue ? ` · ${venue}` : ""}{event.numCourts ? ` · ${event.numCourts} court${event.numCourts === 1 ? "" : "s"}` : ""}
          </div>
        </header>

        {/* Event comments */}
        {event.comments && (
          <section style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 6, padding: "10px 12px", marginBottom: 16, fontSize: 13, color: "#78350f", whiteSpace: "pre-wrap" }}>
            {event.comments}
          </section>
        )}

        {/* Per-court grid */}
        <section style={{ display: "grid", gridTemplateColumns: `repeat(${event.numCourts}, minmax(0, 1fr))`, gap: 12 }}>
          {Array.from({ length: event.numCourts }, (_, i) => i + 1).map((courtNum) => {
            const games = buckets[String(courtNum)] || [];
            return (
              <div key={courtNum}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#475569", textTransform: "uppercase", marginBottom: 6 }}>
                  Court {courtNum}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {games.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>no matches</div>
                  ) : games.map((g) => {
                    const cat = categoryById.get(g.category.id);
                    const scoring = g.scoringFormatOverride || cat?.scoringFormat || null;
                    const winBy = g.winByOverride || cat?.winBy || "2";
                    const fmt = scoring ? shortFormatLabel(scoring, winBy) : null;
                    const homeIsTeam2 = event.hostTeamId != null && g.team2Id === event.hostTeamId;
                    const topId = homeIsTeam2 ? g.team2Id : g.team1Id;
                    const botId = homeIsTeam2 ? g.team1Id : g.team2Id;
                    const topPlayers: string[] = [];
                    const botPlayers: string[] = [];
                    for (const gp of g.gamePlayers) {
                      const name = playerById.get(gp.playerId) || "?";
                      const teamForPlayer = gp.team === 1 ? g.team1Id : g.team2Id;
                      if (teamForPlayer === topId) topPlayers.push(name);
                      else botPlayers.push(name);
                    }
                    const kindBadge = g.kind === "principal" ? "★ Principal" : g.kind === "league" ? "League" : "Extra";
                    const kindColor = g.kind === "principal" ? "#15803d" : g.kind === "league" ? "#2563eb" : "#64748b";
                    return (
                      <div key={g.id} style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 10px", pageBreakInside: "avoid" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12, fontWeight: 600, color: "#475569" }}>
                          <span>{timeHHMM(g.scheduledAt)}</span>
                          <span style={{ fontSize: 10, color: kindColor, fontWeight: 700 }}>{kindBadge}</span>
                        </div>
                        <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 1 }}>
                          {g.category.name} · Match {g.slotNumber}
                        </div>
                        {fmt && <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>{fmt}</div>}
                        <div style={{ marginTop: 6, fontSize: 12 }}>
                          <div style={{ fontWeight: 600, color: "#0f172a" }}>{teamShort(topId)}</div>
                          <div style={{ fontSize: 11, color: "#475569" }}>{topPlayers.join(", ") || <span style={{ color: "#94a3b8" }}>—</span>}</div>
                        </div>
                        <div style={{ marginTop: 4, fontSize: 12 }}>
                          <div style={{ fontWeight: 600, color: "#0f172a" }}>{teamShort(botId)}</div>
                          <div style={{ fontSize: 11, color: "#475569" }}>{botPlayers.join(", ") || <span style={{ color: "#94a3b8" }}>—</span>}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        <footer style={{ marginTop: 20, fontSize: 10, color: "#94a3b8", textAlign: "center" }}>
          Generated by FriendlyBall · {new Date().toLocaleString()}
        </footer>
      </div>
    </>
  );
}
