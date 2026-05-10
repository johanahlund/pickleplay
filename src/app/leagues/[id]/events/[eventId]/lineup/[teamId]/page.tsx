"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { AppHeader } from "@/components/AppHeader";
import { useConfirm } from "@/components/ConfirmDialog";
import { useHideBottomNav, usePollingRefresh } from "@/lib/hooks";
import { resolveRoundCategories, type LeagueCategoryShape } from "@/lib/leagueRound";
import { frameClass } from "@/components/Card";

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
  const { confirm: confirmDialog } = useConfirm();
  const userId = (session?.user as { id?: string })?.id;
  const userRole = (session?.user as { role?: string })?.role;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [team, setTeam] = useState<{ id: string; name: string; captainId: string | null; viceCaptainId: string | null } | null>(null);
  const [opponentTeam, setOpponentTeam] = useState<{ id: string; name: string } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [leagueOrg, setLeagueOrg] = useState<{ createdById: string | null; deputyId: string | null }>({ createdById: null, deputyId: null });
  const [leagueName, setLeagueName] = useState<string>("");
  const [eventDate, setEventDate] = useState<string | null>(null);
  const [roster, setRoster] = useState<PlayerLite[]>([]);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [readyByTeam, setReadyByTeam] = useState<Record<string, boolean>>({});
  // Per-category counter of "extra" empty slot rows the user has revealed
  // via "+ Add match". Local-only — resets on remount. Keeps the default
  // view to a single row per category until the captain explicitly asks
  // for more.
  const [extraSlots, setExtraSlots] = useState<Record<string, number>>({});
  const [picker, setPicker] = useState<PickerTarget | null>(null);

  const isAppAdmin = userRole === "admin";
  const isOrganizer = isAppAdmin || (!!userId && (leagueOrg.createdById === userId || leagueOrg.deputyId === userId));
  const isTeamLeader = !!userId && team && (team.captainId === userId || team.viceCaptainId === userId);
  const canEdit = isOrganizer || isTeamLeader;

  useHideBottomNav();

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
    setLeagueName(league.shortName || league.name || "");

    const t = (league.teams || []).find((x: { id: string }) => x.id === teamId);
    if (t) {
      setTeam({ id: t.id, name: t.name, captainId: t.captain?.id || null, viceCaptainId: t.viceCaptain?.id || null });
      setRoster((t.players || []).map((tp: { player: PlayerLite }) => tp.player));
    }

    const ev = (round?.events || []).find((e: { id: string }) => e.id === eventId);
    setEventDate(ev?.date ?? null);
    const opp = ev?.leagueTeams?.find((lt: { teamId: string }) => lt.teamId !== teamId);
    setOpponentTeam(opp ? { id: opp.team.id, name: opp.team.name } : null);
    const ready: Record<string, boolean> = {};
    for (const lt of (ev?.leagueTeams ?? []) as { teamId: string; lineupReady?: boolean }[]) {
      ready[lt.teamId] = !!lt.lineupReady;
    }
    setReadyByTeam(ready);

    setGames(((ev?.leagueGames as Game[]) || []));

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

  // Poll so each team sees the opponent's picks live. Pauses while a
  // save is in flight or the picker is open so we don't clobber mid-edit.
  usePollingRefresh(loadAll, 15000, !loading && !saving && !picker);

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

  // Same as `post` but does not await loadAll() — caller has already done an
  // optimistic update locally. We re-sync silently in the background.
  const postOptimistic = async (body: Record<string, unknown>, rollback: () => void) => {
    setErrorMsg(null);
    const r = await fetch(`/api/leagues/${id}/events/${eventId}/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setErrorMsg(d.error || "Failed");
      rollback();
      return;
    }
    // Reconcile with server truth (real ids, opp's wants, etc.) — but the
    // checkbox itself has already flipped, so the user feels no latency.
    await loadAll();
  };

  const toggleSlot = async (categoryId: string, slotNumber: number, want: boolean) => {
    const g = gameByKey.get(`${categoryId}:${slotNumber}`);
    if (!want && g && ourPlayersForGame(g).length > 0) {
      const ok = await confirmDialog({
        title: "Untick this match?",
        message: "It has assigned players. They'll be cleared.",
        confirmText: "Untick",
        danger: true,
      });
      if (!ok) return;
      // Server still blocks until players are removed. Walk them off first.
      await post({ action: "assign_players", gameId: g.id, playerIds: [] });
    }
    if (ourSide === null) return;
    const wantsField: "team1Wants" | "team2Wants" = ourSide === 1 ? "team1Wants" : "team2Wants";
    const otherWantsField: "team1Wants" | "team2Wants" = ourSide === 1 ? "team2Wants" : "team1Wants";
    const opponentTeamId = ourSide === 1 ? team!.id : opponentTeam?.id || "";
    void opponentTeamId;

    // Snapshot for rollback.
    const snapshot = games;
    setGames((prev) => {
      const existing = prev.find((x) => x.categoryId === categoryId && x.slotNumber === slotNumber);
      if (want) {
        if (existing) {
          return prev.map((x) => x === existing ? { ...x, [wantsField]: true } : x);
        }
        // Lazy-create a placeholder so the UI flips immediately. The real
        // id arrives on reconcile (loadAll), then this synthetic row is
        // replaced by the server's row — we keep keys stable by category+slot.
        const t1 = team!.id.localeCompare(opponentTeam?.id || "") < 0 ? team!.id : (opponentTeam?.id || "");
        const t2 = t1 === team!.id ? (opponentTeam?.id || "") : team!.id;
        // Mirror the server: first slot in a category becomes principal.
        const hasPrincipal = prev.some((x) => x.categoryId === categoryId && x.kind === "principal");
        const synthetic: Game = {
          id: `pending-${categoryId}-${slotNumber}`,
          categoryId, slotNumber,
          team1Id: t1, team2Id: t2,
          team1Wants: ourSide === 1, team2Wants: ourSide === 2,
          kind: hasPrincipal ? "league" : "principal",
          winnerId: null, gamePlayers: [],
        };
        return [...prev, synthetic];
      }
      // Untick: clear our flag; if the other team also doesn't want, drop the row.
      if (!existing) return prev;
      const otherWants = existing[otherWantsField];
      if (!otherWants) return prev.filter((x) => x !== existing);
      return prev.map((x) => x === existing ? { ...x, [wantsField]: false } : x);
    });
    await postOptimistic(
      { action: "toggle_slot", categoryId, slotNumber, want },
      () => setGames(snapshot),
    );
  };

  const assignPlayers = async (gameId: string, playerIds: string[]) => {
    // Optimistic: replace our team's players locally, leave opponent rows.
    const snapshot = games;
    const rosterIds = new Set(roster.map((p) => p.id));
    setGames((prev) => prev.map((g) => {
      if (g.id !== gameId) return g;
      const oppPlayers = g.gamePlayers.filter((gp) => !rosterIds.has(gp.playerId));
      const ourPlayers = playerIds.map((pid) => {
        const known = roster.find((p) => p.id === pid);
        return { playerId: pid, player: { id: pid, name: known?.name ?? "…" } };
      });
      return { ...g, gamePlayers: [...oppPlayers, ...ourPlayers] };
    }));
    await postOptimistic(
      { action: "assign_players", gameId, playerIds },
      () => setGames(snapshot),
    );
  };

  const setReady = async (ready: boolean) => {
    if (!team) return;
    const snapshot = readyByTeam;
    setReadyByTeam((prev) => ({ ...prev, [team.id]: ready }));
    await postOptimistic(
      { action: "set_ready", ready },
      () => setReadyByTeam(snapshot),
    );
  };

  const setKind = async (gameId: string, kind: "principal" | "league" | "extra") => {
    // Optimistic: flip the badge instantly. If promoting to principal,
    // demote any other principal in the same category.
    const target = games.find((g) => g.id === gameId);
    if (!target) return;
    const snapshot = games;
    setGames((prev) => prev.map((g) => {
      if (g.id === gameId) return { ...g, kind };
      if (kind === "principal" && g.categoryId === target.categoryId && g.kind === "principal") {
        return { ...g, kind: "league" };
      }
      return g;
    }));
    await postOptimistic(
      { action: "set_kind", gameId, kind },
      () => setGames(snapshot),
    );
  };

  // Whether opponent rosters/sign-ups are revealed. We reveal once both
  // teams have set lineupReady (or for league organizers/admin via the
  // server, who get full data anyway).
  const bothReady = !!(team && opponentTeam && readyByTeam[team.id] && readyByTeam[opponentTeam.id]);
  // Captain edits are locked once their own team has flipped ready=true.
  // The "Re-open" button stays available so they can unlock and edit again.
  const ourLocked = !!(team && readyByTeam[team.id]);

  // Player pools for the picker. Recommended = signup with prefer/ok for
  // this category (own team). All sign-ups (own) = anyone on our roster who
  // signed up. Roster (own) = team players (incl. non-signups). Opponent
  // sign-ups appear only after both teams reveal — they're informational
  // and not pickable.
  // All pools are filtered to players whose gender matches the category:
  //   male → "M", female → "F", mix/open → everyone (incl. unknown gender).
  const buildPools = (cat: Category) => {
    const matchesGender = (g: string | null | undefined) => {
      if (cat.gender === "male") return g === "M";
      if (cat.gender === "female") return g === "F";
      return true;
    };
    const rosterById = new Map(roster.map((p) => [p.id, p]));
    const recommended: PlayerLite[] = [];
    const allSignups: PlayerLite[] = [];
    const opponentSignups: PlayerLite[] = [];
    for (const s of signups) {
      if (!matchesGender(s.player.gender)) continue;
      const pl: PlayerLite = { ...s.player, gender: s.player.gender ?? null };
      const onRoster = rosterById.has(s.playerId);
      if (onRoster) {
        allSignups.push(pl);
        const pref = s.signupPreferences?.[cat.id]?.level;
        if (pref === "prefer" || pref === "ok") recommended.push(pl);
      } else if (bothReady) {
        // Show opponent sign-ups only after the reveal. Useful for matchup
        // visibility — captain can see who they'll play against.
        opponentSignups.push(pl);
      }
    }
    const filteredRoster = roster.filter((p) => matchesGender(p.gender));
    const byName = (a: PlayerLite, b: PlayerLite) => a.name.localeCompare(b.name);
    return {
      recommended: recommended.sort(byName),
      allSignups: allSignups.sort(byName),
      opponentSignups: opponentSignups.sort(byName),
      roster: filteredRoster.sort(byName),
    };
  };

  const back = () => router.push(`/events/${eventId}`);

  if (loading) return <div className="text-sm text-muted py-8 text-center">Loading lineup…</div>;
  if (!team || !canEdit) {
    return (
      <>
        <AppHeader variant="hero-sub" title="Lineup" back={{ label: "Back", onClick: back }} />
        <div className="space-y-2">
          <div className={`${frameClass} p-4 text-sm`}>
            You don&apos;t have permission to edit this team&apos;s lineup.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AppHeader
        variant="hero-sub"
        title={`Lineup — ${team.name}`}
        meta={opponentTeam ? `vs ${opponentTeam.name}` : undefined}
        back={{ label: "Back to event", onClick: back }}
      />
    <div className="space-y-2">

      <div className={`${frameClass} p-4 space-y-2`}>
        {(leagueName || eventDate) && (
          <div className="text-[11px] text-muted">
            {leagueName}
            {leagueName && eventDate && " · "}
            {eventDate && new Date(eventDate).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
          </div>
        )}

        {/* Done picking — per-team flag. Until both teams flip true, each
            team only sees its own players in the rows below. */}
        {(() => {
          const myReady = team ? !!readyByTeam[team.id] : false;
          const oppReady = opponentTeam ? !!readyByTeam[opponentTeam.id] : false;
          const bothReady = myReady && oppReady;
          return (
            <div className={`mt-1 rounded-lg border p-2 flex items-center justify-between gap-2 ${
              bothReady ? "bg-emerald-50 border-emerald-200"
              : myReady ? "bg-amber-50 border-amber-200"
              : "bg-gray-50 border-border"
            }`}>
              <div className="flex-1 text-xs">
                <div className="font-medium">
                  {bothReady ? "Both teams done picking — lineups revealed."
                    : myReady ? `Waiting for ${opponentTeam?.name || "opponent"}…`
                    : "Mark as done when your lineup is final."}
                </div>
                <div className="text-[10px] text-muted">
                  {opponentTeam?.name || "Opponent"}: {oppReady ? "✓ done" : "still picking"}
                </div>
              </div>
              <button
                type="button"
                disabled={saving || !isTeamLeader}
                onClick={() => setReady(!myReady)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap ${
                  myReady ? "bg-gray-200 text-foreground" : "bg-action text-white"
                } disabled:opacity-50`}
              >{myReady ? "Re-open" : "Mark done"}</button>
            </div>
          );
        })()}

        {errorMsg && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">{errorMsg}</div>
        )}
        <p className="text-[11px] text-muted">
          Tick the slots your team wants to play. Then assign your players. The opponent sees the same grid and ticks their own. One game per category should be marked as <span className="font-medium">Principal</span> — that&apos;s the match that counts for category standings.
        </p>
      </div>

      {categories.map((cat) => {
        const max = cat.maxPerEvent ?? 1;
        const existingSlots = games
          .filter((g) => g.categoryId === cat.id)
          .map((g) => g.slotNumber);
        const maxExisting = Math.max(0, ...existingSlots);
        // Visible rows = slots already created + however many empty rows the
        // captain has explicitly added (via the "+ Add match" pill). Always
        // show at least 1 row so a fresh category has a checkbox to tick.
        const visibleSlotCount = Math.min(
          max,
          Math.max(1, maxExisting + (extraSlots[cat.id] || 0)),
        );
        const slots = Array.from({ length: visibleSlotCount }, (_, i) => i + 1);
        const canAddMore = visibleSlotCount < max;
        const principalCount = games.filter((g) => g.categoryId === cat.id && g.kind === "principal").length;

        return (
          <div key={cat.id} className={`${frameClass} shadow-sm p-3 space-y-2 border-l-4 border-l-action/60`}>
            <div className="flex items-baseline justify-between gap-2 pb-1.5 border-b border-border/70 -mx-3 px-3">
              <div className="text-base font-bold">{cat.name}</div>
              <div className="flex items-baseline gap-2">
                <div className="text-[11px] text-muted">{cat.format} · max {max}</div>
                {canAddMore && !ourLocked && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setExtraSlots((prev) => ({ ...prev, [cat.id]: (prev[cat.id] || 0) + 1 }))}
                    className="text-[11px] text-action font-medium hover:underline disabled:opacity-50"
                  >+ Add match</button>
                )}
              </div>
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
                <div key={slotNum} className={`relative border rounded-lg p-2 ${isPrincipal ? "border-emerald-300 bg-emerald-50/40" : "border-border"}`}>
                  {/* Hide an empty extra row the captain added but didn't tick.
                      Top-right red ✕, only when the row hasn't been ticked yet
                      (rows with a game must be unticked to remove). */}
                  {!ourWants && !g && slotNum > 1 && (
                    <button
                      type="button"
                      aria-label="Hide this match row"
                      onClick={() => setExtraSlots((prev) => ({ ...prev, [cat.id]: Math.max(0, (prev[cat.id] || 0) - 1) }))}
                      className="absolute top-1 right-1 text-danger hover:bg-red-50 rounded w-5 h-5 flex items-center justify-center text-xs leading-none"
                    >✕</button>
                  )}
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ourWants}
                        disabled={saving || locked || ourLocked}
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
                            disabled={saving || locked || ourLocked || (k === "principal" && isPrincipal && principalCount > 1)}
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
                          disabled={saving || locked || ourLocked}
                          onClick={() => setPicker({ categoryId: cat.id, slotNumber: slotNum, which: ourPlayers.length === 0 || !isDoubles(cat) ? 1 : 2 })}
                          className="text-xs text-action font-medium px-2 py-1 rounded-full border border-dashed border-action/40 hover:bg-action/5 disabled:opacity-50"
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
          // If they haven't signed up yet, offer to fill their preferences
          // on their behalf (common when a player doesn't have the app).
          const su = signups.find((s) => s.playerId === pid);
          if (!su) {
            const playerName = pools.roster.find((p) => p.id === pid)?.name || "This player";
            const ok = await confirmDialog({
              title: `${playerName} hasn't signed up`,
              message: "Open their sign-up form? You'll fill it in on their behalf.",
              confirmText: "Open",
            });
            if (!ok) return;
            router.push(`/events/${eventId}/sign-up?for=${pid}`);
            return;
          }
          if (su.status === "unavailable") {
            const playerName = pools.roster.find((p) => p.id === pid)?.name || "This player";
            const ok = await confirmDialog({
              title: `${playerName} is unavailable`,
              message: "They marked themselves out for this event. Add anyway?",
              confirmText: "Add",
            });
            if (!ok) return;
          }
          await assignPlayers(g.id, next);
        };

        const Section = ({ title, players, hint, readOnly }: { title: string; players: PlayerLite[]; hint?: string; readOnly?: boolean }) => (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted">{title}{hint ? ` · ${hint}` : ""}</div>
            {players.length === 0 ? (
              <p className="text-xs text-muted italic px-2 py-1">No matches.</p>
            ) : players.map((p) => {
              const selected = currentIds.includes(p.id);
              const su = signups.find((s) => s.playerId === p.id);
              const cantCome = su && su.status === "unavailable";
              const noPref = su?.signupPreferences?.[cat.id]?.level === "no";
              const RowTag: "button" | "div" = readOnly ? "div" : "button";
              return (
                <RowTag
                  key={`${title}-${p.id}`}
                  {...(readOnly ? {} : { type: "button" as const, onClick: () => choose(p.id) })}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border ${
                    readOnly ? "border-border bg-gray-50/50 cursor-default"
                    : selected ? "border-action bg-action/10"
                    : "border-border hover:bg-gray-50"
                  }`}
                >
                  <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="xs" />
                  <span className={`flex-1 text-left text-sm ${cantCome ? "line-through text-muted" : ""}`}>{p.name}</span>
                  {p.gender && <span className={`text-xs ${p.gender === "F" ? "text-pink-500" : "text-blue-500"}`}>{p.gender === "F" ? "♀" : "♂"}</span>}
                  {cantCome && <span className="text-[10px] text-rose-600">unavailable</span>}
                  {noPref && !cantCome && <span className="text-[10px] text-amber-600">said &ldquo;no&rdquo;</span>}
                </RowTag>
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
                {bothReady && pools.opponentSignups.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Section title={`${team!.name} sign-ups`} players={pools.allSignups.filter((p) => !pools.recommended.some((r) => r.id === p.id))} />
                    <Section title={`${opponentTeam?.name || "Opponent"} sign-ups`} players={pools.opponentSignups} readOnly />
                  </div>
                ) : (
                  <Section title="All sign-ups" players={pools.allSignups.filter((p) => !pools.recommended.some((r) => r.id === p.id))} />
                )}
                <Section title="Roster" players={pools.roster.filter((p) => !pools.allSignups.some((s) => s.id === p.id))} />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
    </>
  );
}
