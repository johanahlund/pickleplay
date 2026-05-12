"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { frameClass } from "@/components/Card";

interface QueryRow {
  id: string;
  conversationId: string;
  question: string;
  answer: string;
  piiScrubbed: boolean;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheCreate: number;
  errorMessage: string | null;
  createdAt: string;
  player: { id: string; name: string; photoUrl: string | null } | null;
}

interface ApiResponse {
  total: number;
  rows: QueryRow[];
}

interface LeagueLite {
  name: string;
  shortName: string | null;
}

/**
 * League organizer / app admin viewer for the jabberBrain League
 * Assistant chat logs. Read-only — surfaces what players ask plus any
 * Anthropic usage telemetry per turn.
 */
export default function AssistantLogsPage() {
  const params = useParams();
  const leagueId = String(params?.id || "");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [league, setLeague] = useState<LeagueLite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!leagueId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`/api/leagues/${leagueId}/assistant-queries?limit=500`).then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `Failed (${r.status})`);
        }
        return r.json() as Promise<ApiResponse>;
      }),
      fetch(`/api/leagues/${leagueId}`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([d, lg]) => {
        setData(d);
        if (lg) setLeague({ name: lg.name, shortName: lg.shortName ?? null });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [leagueId]);

  // Group rows by conversationId, preserving newest-first order at
  // both the conversation level (using each group's max createdAt) and
  // within each conversation (newest turn first).
  const grouped = useMemo(() => {
    if (!data) return [] as { conversationId: string; rows: QueryRow[]; latest: string }[];
    const map = new Map<string, QueryRow[]>();
    for (const r of data.rows) {
      const list = map.get(r.conversationId) || [];
      list.push(r);
      map.set(r.conversationId, list);
    }
    const groups = Array.from(map.entries()).map(([cid, rows]) => ({
      conversationId: cid,
      rows: rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      latest: rows.reduce((acc, r) => (r.createdAt > acc ? r.createdAt : acc), rows[0]!.createdAt),
    }));
    groups.sort((a, b) => b.latest.localeCompare(a.latest));
    return groups;
  }, [data]);

  const filtered = useMemo(() => {
    if (!query.trim()) return grouped;
    const q = query.trim().toLowerCase();
    return grouped
      .map((g) => ({ ...g, rows: g.rows.filter((r) => r.question.toLowerCase().includes(q) || r.answer.toLowerCase().includes(q)) }))
      .filter((g) => g.rows.length > 0);
  }, [grouped, query]);

  const toggle = (cid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid); else next.add(cid);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <Link href={`/leagues/${leagueId}`} className="text-sm text-action">&larr; League</Link>

      <div>
        <h1 className="text-xl font-bold">
          Assistant chat logs
          {league && (
            <span className="text-base font-medium text-muted"> · {league.shortName ?? league.name}</span>
          )}
        </h1>
        <p className="text-xs text-muted mt-0.5">
          Every question asked through the jabberBrain League Assistant and the answer it gave. Grouped by chat session.
        </p>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search questions or answers…"
        className="w-full border border-border rounded-xl px-3 py-2 text-sm"
      />

      {loading && <p className="text-sm text-muted">Loading…</p>}
      {error && (
        <div className={`${frameClass} p-3 text-sm text-danger`}>
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          <p className="text-xs text-muted">
            {data.total} turn{data.total === 1 ? "" : "s"} across {grouped.length} conversation{grouped.length === 1 ? "" : "s"}.
          </p>
          {filtered.length === 0 ? (
            <div className={`${frameClass} p-4 text-sm text-muted text-center`}>
              {data.total === 0 ? "Nobody has asked the assistant anything yet." : "No matches."}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((g) => {
                const isOpen = expanded.has(g.conversationId);
                const firstQ = g.rows[g.rows.length - 1]!;
                return (
                  <div key={g.conversationId} className={`${frameClass} overflow-hidden`}>
                    <button
                      type="button"
                      onClick={() => toggle(g.conversationId)}
                      className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-start gap-3"
                    >
                      <span className={`text-muted text-xs mt-0.5 transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-[10px] text-muted">
                          <span>{new Date(g.latest).toLocaleString()}</span>
                          <span>·</span>
                          <span>{g.rows.length} turn{g.rows.length === 1 ? "" : "s"}</span>
                          <span>·</span>
                          <span>{firstQ.player ? firstQ.player.name : "Anonymous"}</span>
                        </div>
                        <p className="text-sm mt-0.5 truncate">{firstQ.question}</p>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="border-t border-border px-4 py-3 space-y-3 bg-gray-50">
                        {g.rows.slice().reverse().map((r) => (
                          <div key={r.id} className="space-y-1.5">
                            <div className="flex justify-end">
                              <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm bg-action text-white text-xs whitespace-pre-wrap break-words">
                                {r.question}
                              </div>
                            </div>
                            <div className="flex justify-start">
                              <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-bl-sm bg-white border border-border text-xs whitespace-pre-wrap break-words">
                                {r.errorMessage ? (
                                  <span className="text-danger">⚠ {r.errorMessage}</span>
                                ) : (
                                  r.answer || <span className="text-muted italic">(empty)</span>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-muted pl-2">
                              <span>{new Date(r.createdAt).toLocaleTimeString()}</span>
                              <span>in {r.tokensInput} · out {r.tokensOutput}</span>
                              {(r.tokensCacheRead > 0 || r.tokensCacheCreate > 0) && (
                                <span>cache r{r.tokensCacheRead}/c{r.tokensCacheCreate}</span>
                              )}
                              {r.piiScrubbed && <span className="text-amber-600">PII scrubbed</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
