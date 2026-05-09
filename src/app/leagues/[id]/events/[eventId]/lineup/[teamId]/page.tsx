"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { resolveRoundCategories, type LeagueCategoryShape } from "@/lib/leagueRound";

interface PlayerLite { id: string; name: string; photoUrl?: string | null; gender?: string | null; duprRating?: number | null }
interface Category extends LeagueCategoryShape { id: string }
interface Game {
  id: string; categoryId: string; slotNumber: number;
  team1Id: string; team2Id: string;
  team1Wants: boolean; team2Wants: boolean;
  kind: "principal" | "league" | "extra";
  winnerId: string | null;
  gamePlayers: { playerId: string; player: { id: string; name: string } }[];
}
interface Signup {
  playerId: string;
  status: "playing" | "attending" | "unavailable" | string;
  signupPreferences: Record<string, { level: "prefer" | "ok" | "no"; note?: string }> | null;
  player: { id: string; name: string; photoUrl: string | null; gender: string | null };
}

// 1-based picker slot identity. `which` only used in doubles.
type PickerTarget = { categoryId: string; slotNumber: number; which: 1 | 2 };

export default function LineupBuilderPage() {
  const { id, eventId, teamId } = useParams() as { id: string; eventId: string; teamId: string };
  const router = useRouter();
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string })?.id;
  const userRole = (session?.user as { role?: string })?.role;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [team, setTeam] = useState<{ id: string; name: string; captainId: string | null; viceCaptainId: string | null } | null>(null);
  const [opponentTeam, setOpponentTeam] = useState<{ id: string; name: string } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [leagueOrg, setLeagueOrg] = useState<{ createdById: string | null; deputyId: string | null }>({ createdById: null, deputyId: null });
  const [roster, setRoster] = useState<PlayerLite[]>([]);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [picker, setPicker] = useState<PickerTarget | null>(null);

  const isAppAdmin = userRole === "admin";
  const isOrganizer = isAppAdmin || (!!userId && (leagueOrg.createdById === userId || leagueOrg.deputyId === userId));
  const isTeamLeader = !!userId && team && (team.captainId === userId || team.viceCaptainId === userId);
  const canEdit = isOrganizer || isTeamLeader;

  // Hide bottom nav while editing.
  useEffect(() => {
    const nav = document.querySelector("nav.fixed.bottom-0");
    nav?.classList.add("hidden");
    return () => { nav?.classList.remove("hidden"); };
  }, []);

  const loadAll = useCallback(async () => {
    const [leagueR, eventR] = await Promise.all([
      fetch(`/api/leagues/${id}`),
      fetch(`/api/events/${eventId}`),
    ]);
    if (!leagueR.ok || !eventR.ok) { setLoading(false); return; }
    const league = await leagueR.json();
    const event = await eventR.json();

    // Resolve the effective categories for this round.
    const round = (league.rounds || []).find((r: { id: string; events: { id: string }[] }) =>
      r.events.some((e) => e.id === eventId),
    );
    const effectiveCategories = resolveRoundCategories(round, league.categories || [])
      .filter((c): c is Category => !!c.id && c.status !== "draft");
    setCategories(effectiveCategories);
    setLeagueOrg({ createdById: league.createdBy?.id || null, deputyId: league.deputy?.id || null });

    const t = (league.teams || []).find((x: { id: string }) => x.id === teamId);
    if (t) {
      setTeam({ id: t.id, name: t.name, captainId: t.captain?.id || null, viceCaptainId: t.viceCaptain?.id || null });
      setRoster((t.players || []).map((tp: { player: PlayerLite }) => tp.player));
    }

    const opp = (round?.events || []).find((e: { id: string }) => e.id === eventId)?.leagueTeams
      ?.find((lt: { teamId: string }) => lt.teamId !== teamId);
    setOpponentTeam(opp ? { id: opp.team.id, name: opp.team.name } : null);

    setGames(((round?.events || []).find((e: { id: string }) => e.id === eventId)?.leagueGames as Game[]) || []);

    // Sign-ups + their per-category preferences come from /api/events/[id]
    const eventPlayers: Signup[] = (event.players || []).map((p: { playerId: string; status: string; signupPreferences: unknown; player: { id: string; name: string; photoUrl: string | null; gender: string | null } }) => ({
      playerId: p.playerId,
      status: p.status,
      signupPreferences: (p.signupPreferences as Record<string, { level: "prefer" | "ok" | "no"; note?: string }> | null) ?? null,
      player: p.player,
    }));
    setSignups(eventPlayers);

    setLoading(false);
  }, [id, eventId, teamId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Determine which side our team is on. Canonical mapping = sort by id;
  // server uses the same rule, so first id alphabetically is team1.
  const ourSide: 1 | 2 | null = useMemo(() => {
    if (!team || !opponentTeam) return null;
    return team.id.localeCompare(opponentTeam.id) < 0 ? 1 : 2;
  }, [team, opponentTeam]);

  const wantsField = (g: Game): boolean => ourSide === 1 ? g.team1Wants : g.team2Wants;

  // Build (categoryId → slotNumber → game) map.
  const gameByKey = useMemo(() => {
    const m = new Map<string, Game>();
    for (const g of games) m.set(`${g.categoryId}:${g.slotNumber}`, g);
    return m;
  }, [games]);

  // Players belonging to this row's "our side" only — the opponent's
  // players are revealed below their column.
  const ourPlayersForGame = (g: Game): { id: string; name: string }[] => {
    const rosterIds = new Set(roster.map((p) => p.id));
    return g.gamePlayers.filter((gp) => rosterIds.has(gp.playerId)).map((gp) => gp.player);
  };
  const oppPlayersForGame = (g: Game): { id: string; name: string }[] => {
    const rosterIds = new Set(roster.map((p) => p.id));
    return g.gamePlayers.filter((gp) => !rosterIds.has(gp.playerId)).map((gp) => gp.player);
  };

  const isDoubles = (cat: Category) => cat.format === "doubles";

  const post = async (body: Record<string, unknown>) => {
    setSaving(true);
    setErrorMsg(null);
    const r = await fetch(`/api/leagues/${id}/events/${eventId}/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setErrorMsg(d.error || "Failed");
      return false;
    }
    await loadAll();
    return true;
  };

  const toggleSlot = async (categoryId: string, slotNumber: number, want: boolean) => {
    const g = gameByKey.get(`${categoryId}:${slotNumber}`);
    if (!want && g && ourPlayersForGame(g).length > 0) {
      const ok = window.confirm("This slot has assigned players. Untick anyway?");
      if (!ok) return;
      // Server still blocks until players are removed. Walk them off first.
      await post({ action: "assign_players", gameId: g.id, playerIds: [] });
    }
    await post({ action: "toggle_slot", categoryId, slotNumber, want });
  };

  const assignPlayers = async (gameId: string, playerIds: string[]) => {
    await post({ action: "assign_players", gameId, playerIds });
  };

  const setKind = async (gameId: string, kind: "principal" | "league" | "extra") => {
    await post({ action: "set_kind", gameId, kind });
  };

  // Player pools for the picker. Recommended = signup with prefer/ok for this
  // category. All sign-ups = anyone signed up regardless of category prefs.
  // Roster = team players (even non-signups).
  const buildPools = (cat: Category) => {
    const rosterById = new Map(roster.map((p) => [p.id, p]));
    const recommended: PlayerLite[] = [];
    const allSignups: PlayerLite[] = [];
    for (const s of signups) {
      const onRoster = rosterById.has(s.playerId);
      if (!onRoster) continue; // only show our roster's signups
      const pl: PlayerLite = { ...s.player, gender: s.player.gender ?? null };
      allSignups.push(pl);
      const pref = s.signupPreferences?.[cat.id]?.level;
      if (pref === "prefer" || pref === "ok") recommended.push(pl);
    }
    return { recommended, allSignups, roster };
  };

  const back = () => router.push(`/leagues/${id}?tab=rounds`);

  if (loading) return <div className="text-sm text-muted py-8 text-center">Loading lineup…</div>;
  if (!team || !canEdit) {
    return (
      <div className="space-y-2">
        <button onClick={back} className="text-sm text-action font-medium">← Back</button>
        <div className="bg-card rounded-xl border border-border p-4 text-sm">
          You don&apos;t have permission to edit this team&apos;s lineup.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="sticky top-0 z-30 bg-background -mx-4 px-4 py-2">
        <button onClick={back} className="text-sm text-action font-medium">← Back to Rounds</button>
      </div>

      <div className="bg-card rounded-xl border border-border p-4">
        <h2 className="text-lg font-bold">Lineup — {team.name}</h2>
        <div className="text-xs text-muted">vs {opponentTeam?.name || "—"}</div>
        {errorMsg && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 mt-2">{errorMsg}</div>
        )}
        <p className="text-[11px] text-muted mt-2">
          Tick the slots your team wants to play. Then assign your players. The opponent sees the same grid and ticks their own. One game per category should be marked as <span className="font-medium">Principal</span> — that&apos;s the match that counts for category standings.
        </p>
      </div>

      {categories.map((cat) => {
        const max = cat.maxPerEvent ?? 1;
        const existingSlots = games
          .filter((g) => g.categoryId === cat.id)
          .map((g) => g.slotNumber);
        const slotCount = Math.min(Math.max(...[0, ...existingSlots]) + 1, max);
        const slots = Array.from({ length: Math.max(slotCount, 1) }, (_, i) => i + 1);
        const principalCount = games.filter((g) => g.categoryId === cat.id && g.kind === "principal").length;

        return (
          <div key={cat.id} className="bg-card rounded-xl border border-border p-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-semibold">{cat.name}</div>
              <div className="text-[11px] text-muted">{cat.format} · max {max}</div>
            </div>

            {slots.map((slotNum) => {
              const g = gameByKey.get(`${cat.id}:${slotNum}`);
              const ourWants = !!(g && wantsField(g));
              const oppWants = !!(g && (ourSide === 1 ? g.team2Wants : g.team1Wants));
              const ourPlayers = g ? ourPlayersForGame(g) : [];
              const oppPlayers = g ? oppPlayersForGame(g) : [];
              const locked = !!g?.winnerId;
              const isPrincipal = g?.kind === "principal";

              return (
                <div key={slotNum} className={`border rounded-lg p-2 ${isPrincipal ? "border-emerald-300 bg-emerald-50/40" : "border-border"}`}>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ourWants}
                        disabled={saving || locked}
                        onChange={(e) => toggleSlot(cat.id, slotNum, e.target.checked)}
                      />
                      <span className="text-xs font-medium">Match {slotNum}</span>
                    </label>
                    {g && (
                      <div className="flex items-center gap-1.5">
                        {(["principal", "league", "extra"] as const).map((k) => (
                          <button
                            key={k}
                            type="button"
                            disabled={saving || locked || (k === "principal" && isPrincipal && principalCount > 1)}
                            onClick={() => setKind(g.id, k)}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              g.kind === k
                                ? k === "principal" ? "bg-emerald-500 text-white"
                                  : k === "league"  ? "bg-blue-500 text-white"
                                  : "bg-gray-500 text-white"
                                : "bg-gray-100 text-muted hover:bg-gray-200"
                            }`}
                          >{k}</button>
                        ))}
                      </div>
                    )}
                  </div>

                  {ourWants && g && (
                    <div className="mt-2 space-y-1">
                      <div className="text-[10px] uppercase tracking-wide text-muted">Your players</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {ourPlayers.map((p) => (
                          <span key={p.id} className="px-2 py-1 rounded-full bg-action/10 text-foreground text-xs">{p.name}</span>
                        ))}
                        <button
                          type="button"
                          disabled={saving || locked}
                          onClick={() => setPicker({ categoryId: cat.id, slotNumber: slotNum, which: ourPlayers.length === 0 || !isDoubles(cat) ? 1 : 2 })}
                          className="text-xs text-action font-medium px-2 py-1 rounded-full border border-dashed border-action/40 hover:bg-action/5"
                        >
                          {ourPlayers.length === 0 ? "+ Pick" : isDoubles(cat) && ourPlayers.length < 2 ? "+ Partner" : "Change"}
                        </button>
                      </div>
                    </div>
                  )}

                  {oppWants && (
                    <div className="mt-2">
                      <div className="text-[10px] uppercase tracking-wide text-muted">Opponent ({opponentTeam?.name})</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {oppPlayers.length > 0
                          ? oppPlayers.map((p) => (
                              <span key={p.id} className="px-2 py-1 rounded-full bg-gray-100 text-foreground text-xs">{p.name}</span>
                            ))
                          : <span className="text-xs text-muted italic">picking…</span>}
                      </div>
                    </div>
                  )}
                  {!ourWants && !oppWants && (
                    <p className="text-[11px] text-muted mt-1">Neither team has picked this slot yet.</p>
                  )}
                  {!ourWants && oppWants && (
                    <p className="text-[11px] text-amber-700 mt-1">Opponent is up for this — tick to play.</p>
                  )}
                </div>
              );
            })}

            {slots.length < max && (
              <button
                type="button"
                disabled={saving}
                onClick={() => toggleSlot(cat.id, (slots[slots.length - 1] || 0) + 1, true)}
                className="w-full text-xs text-action font-medium py-1.5 rounded-lg border border-dashed border-action/30"
              >+ Add another match in {cat.name}</button>
            )}
          </div>
        );
      })}

      {/* Player picker overlay */}
      {picker && (() => {
        const cat = categories.find((c) => c.id === picker.categoryId);
        if (!cat) return null;
        const g = gameByKey.get(`${picker.categoryId}:${picker.slotNumber}`);
        if (!g) return null;
        const pools = buildPools(cat);
        const currentIds = ourPlayersForGame(g).map((p) => p.id);
        const close = () => setPicker(null);
        const choose = async (pid: string) => {
          // Singles → replace. Doubles → toggle in/out, capped at 2.
          let next: string[];
          if (!isDoubles(cat)) next = [pid];
          else if (currentIds.includes(pid)) next = currentIds.filter((x) => x !== pid);
          else if (currentIds.length >= 2) next = [currentIds[1], pid];
          else next = [...currentIds, pid];
          // Warn if player isn't in any "playing" sign-up.
          const su = signups.find((s) => s.playerId === pid);
          if (!su || su.status !== "playing") {
            const ok = window.confirm(`${pools.roster.find((p) => p.id === pid)?.name || "This player"} hasn't signed up to play. Add anyway?`);
            if (!ok) return;
          }
          await assignPlayers(g.id, next);
        };

        const Section = ({ title, players, hint }: { title: string; players: PlayerLite[]; hint?: string }) => (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted">{title}{hint ? ` · ${hint}` : ""}</div>
            {players.length === 0 ? (
              <p className="text-xs text-muted italic px-2 py-1">No matches.</p>
            ) : players.map((p) => {
              const selected = currentIds.includes(p.id);
              const su = signups.find((s) => s.playerId === p.id);
              const cantCome = su && su.status === "unavailable";
              const noPref = su?.signupPreferences?.[cat.id]?.level === "no";
              return (
                <button
                  key={`${title}-${p.id}`}
                  type="button"
                  onClick={() => choose(p.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border ${selected ? "border-action bg-action/10" : "border-border hover:bg-gray-50"}`}
                >
                  <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="xs" />
                  <span className={`flex-1 text-left text-sm ${cantCome ? "line-through text-muted" : ""}`}>{p.name}</span>
                  {p.gender && <span className={`text-xs ${p.gender === "F" ? "text-pink-500" : "text-blue-500"}`}>{p.gender === "F" ? "♀" : "♂"}</span>}
                  {cantCome && <span className="text-[10px] text-rose-600">unavailable</span>}
                  {noPref && !cantCome && <span className="text-[10px] text-amber-600">said &ldquo;no&rdquo;</span>}
                </button>
              );
            })}
          </div>
        );

        return (
          <div className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center" onClick={close}>
            <div className="bg-card w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-border p-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">Pick player — {cat.name} match {picker.slotNumber}</h3>
                <button onClick={close} className="text-muted text-sm">Done</button>
              </div>
              <div className="space-y-3">
                <Section title="Recommended" hint="signed up + prefer/ok" players={pools.recommended} />
                <Section title="All sign-ups" players={pools.allSignups.filter((p) => !pools.recommended.some((r) => r.id === p.id))} />
                <Section title="Roster" players={pools.roster.filter((p) => !pools.allSignups.some((s) => s.id === p.id))} />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
