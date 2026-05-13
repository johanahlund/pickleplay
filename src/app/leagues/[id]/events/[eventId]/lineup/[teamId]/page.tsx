"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { AppHeader } from "@/components/AppHeader";
import { useConfirm } from "@/components/ConfirmDialog";
import { useHideBottomNav, usePollingRefresh } from "@/lib/hooks";
import { resolveRoundCategories, resolveRoundConfig, type LeagueCategoryShape } from "@/lib/leagueRound";
import { frameClass } from "@/components/Card";
import { leagueShortName } from "@/lib/leagueDisplay";

interface PlayerLite { id: string; name: string; photoUrl?: string | null; gender?: string | null; duprRating?: number | null }
interface Category extends LeagueCategoryShape { id: string }
interface Game {
  id: string; categoryId: string; slotNumber: number;
  team1Id: string; team2Id: string;
  team1Wants: boolean; team2Wants: boolean;
  kind: "principal" | "league" | "extra";
  winnerId: string | null;
  scheduledAt?: string | null;
  courtNum?: number | null;
  scoringFormatOverride?: string | null;
  winByOverride?: string | null;
  gamePlayers: { playerId: string; team?: number | null; player: { id: string; name: string } }[];
}
interface Signup {
  playerId: string;
  status: "playing" | "attending" | "unavailable" | string;
  signupPreferences: Record<string, { level: "prefer" | "ok" | "no"; note?: string }> | null;
  player: { id: string; name: string; photoUrl: string | null; gender: string | null };
}

// 1-based picker slot identity. `which` only used in doubles.
type PickerTarget = { categoryId: string; slotNumber: number; which: 1 | 2 };

// Compact label for the match format. Examples:
//   formatLabel("3x15", "2") → "Best of 3 to 15 · win by 2"
//   formatLabel("1xR21", "cap18") → "Rally to 21 · GP 18"
function formatLabel(scoring: string, winBy: string): string {
  const SCORING: Record<string, string> = {
    "1x7": "1 set to 7", "1x9": "1 set to 9", "1x11": "1 set to 11", "1x15": "1 set to 15",
    "3x11": "Best of 3 to 11", "3x15": "Best of 3 to 15",
    "1xR15": "Rally to 15", "1xR21": "Rally to 21",
    "3xR15": "Best of 3 rally 15", "3xR21": "Best of 3 rally 21",
  };
  // win-by labels are generated for the full 12..25 range; the static
  // entries cover the no-cap and unbounded variants.
  const WINBY_STATIC: Record<string, string> = { "1": "win by 1", "2": "win by 2" };
  if (WINBY_STATIC[winBy]) return `${SCORING[scoring] ?? scoring} · ${WINBY_STATIC[winBy]}`;
  const gp = winBy.match(/^2_gp(\d+)$/);
  if (gp) return `${SCORING[scoring] ?? scoring} · win by 2 (GP ${gp[1]})`;
  const cap = winBy.match(/^cap(\d+)$/);
  if (cap) return `${SCORING[scoring] ?? scoring} · Cap ${cap[1]}`;
  return `${SCORING[scoring] ?? scoring} · ${winBy}`;
}

const FORMAT_SCORING_OPTS = [
  { v: "1x7", label: "1 set to 7" },
  { v: "1x9", label: "1 set to 9" },
  { v: "1x11", label: "1 set to 11" },
  { v: "1x15", label: "1 set to 15" },
  { v: "3x11", label: "Best of 3 to 11" },
  { v: "3x15", label: "Best of 3 to 15" },
  { v: "1xR15", label: "Rally to 15" },
  { v: "1xR21", label: "Rally to 21" },
  { v: "3xR15", label: "Best of 3 rally 15" },
  { v: "3xR21", label: "Best of 3 rally 21" },
];
const FORMAT_WINBY_OPTS: { v: string; label: string }[] = (() => {
  const out: { v: string; label: string }[] = [
    { v: "1", label: "win by 1" },
    { v: "2", label: "win by 2" },
  ];
  for (let n = 12; n <= 25; n++) out.push({ v: `2_gp${n}`, label: `win by 2 (GP ${n})` });
  for (let n = 12; n <= 25; n++) out.push({ v: `cap${n}`, label: `Cap ${n}` });
  return out;
})();

export default function LineupBuilderPage() {
  const { id, eventId, teamId } = useParams() as { id: string; eventId: string; teamId: string };
  const router = useRouter();
  const { data: session } = useSession();
  const { confirm: confirmDialog, alert: alertDialog } = useConfirm();
  const userId = (session?.user as { id?: string })?.id;
  const userRole = (session?.user as { role?: string })?.role;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [team, setTeam] = useState<{ id: string; name: string; captainId: string | null; viceCaptainId: string | null } | null>(null);
  const [opponentTeam, setOpponentTeam] = useState<{ id: string; name: string } | null>(null);
  // Opponent's roster IDs — used to EXCLUDE them from the wider
  // Friendly-match pool (otherwise we'd be poaching the other team's
  // people). League team rosters are public, so this isn't a secrecy
  // leak; we already loaded league.teams to render the team list.
  const [opponentRosterIds, setOpponentRosterIds] = useState<Set<string>>(new Set());
  const [hostTeamId, setHostTeamId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [leagueOrg, setLeagueOrg] = useState<{ createdById: string | null; deputyId: string | null }>({ createdById: null, deputyId: null });
  const [leagueName, setLeagueName] = useState<string>("");
  const [roundNumber, setRoundNumber] = useState<number | null>(null);
  const [roundName, setRoundName] = useState<string | null>(null);
  const [eventLocation, setEventLocation] = useState<string | null>(null);
  const [eventDate, setEventDate] = useState<string | null>(null);
  // Cap on principal + league matches per event (from round override
  // or league config). null = no cap. Friendly matches don't count.
  const [maxMatchesPerEvent, setMaxMatchesPerEvent] = useState<number | null>(null);
  const [roster, setRoster] = useState<PlayerLite[]>([]);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  // Per-game format-override edit panel state. Key = gameId; absence
  // means panel closed. Value holds the in-progress select choices.
  const [formatEdits, setFormatEdits] = useState<Record<string, { scoringFormat: string; winBy: string }>>({});
  const [savingFormatId, setSavingFormatId] = useState<string | null>(null);
  const [readyByTeam, setReadyByTeam] = useState<Record<string, boolean>>({});
  // Latched cross-team reveal — true the moment both teams' lineupReady
  // first hit true. After it's true the opponent's gamePlayers stay
  // visible regardless of subsequent un-toggles, and edits require
  // mutual unlock (both teams' lineupReady=false).
  const [lineupTotalLocked, setLineupTotalLocked] = useState(false);
  // Per-category counter of "extra" empty slot rows the user has revealed
  // via "+ Add match". Local-only — resets on remount. Keeps the default
  // view to a single row per category until the captain explicitly asks
  // for more.
  const [extraSlots, setExtraSlots] = useState<Record<string, number>>({});
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  // Search query for the player picker. Resets to empty whenever the
  // picker (re-)opens.
  const [pickerSearch, setPickerSearch] = useState("");
  useEffect(() => { if (!picker) setPickerSearch(""); }, [picker]);
  // Player ids whose pill should pulse/highlight on the match card —
  // used to give the captain instant visual confirmation when an
  // assignment lands. Cleared automatically after ~2 seconds.
  const [recentlyChangedPids, setRecentlyChangedPids] = useState<Set<string>>(new Set());
  const flashPlayers = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setRecentlyChangedPids((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    setTimeout(() => {
      setRecentlyChangedPids((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }, 2000);
  }, []);
  // Toggle for the single Expand/Collapse-all button above the category
  // cards. Mirrors the rounds/standings pattern: imperatively sets each
  // <details data-category-card> `open` attribute via querySelectorAll.
  const [categoriesAllCollapsed, setCategoriesAllCollapsed] = useState(false);

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
    const effectiveCfg = resolveRoundConfig(round ?? null, league);
    setMaxMatchesPerEvent(
      typeof effectiveCfg.maxMatchesPerEvent === "number" && effectiveCfg.maxMatchesPerEvent > 0
        ? effectiveCfg.maxMatchesPerEvent
        : null,
    );
    setLeagueOrg({ createdById: league.createdBy?.id || null, deputyId: league.deputy?.id || null });
    setLeagueName(leagueShortName(league));
    setRoundNumber(typeof round?.roundNumber === "number" ? round.roundNumber : null);
    setRoundName(typeof round?.name === "string" && round.name.trim() ? round.name.trim() : null);
    // Venue label for the header: prefer the named ClubLocation, else the
    // club name. Both come from /api/events/[id].
    const eventClub = (event as { club?: { name?: string; locations?: { id: string; name?: string }[] } | null }).club;
    const eventLocationId = (event as { locationId?: string | null }).locationId;
    const matchedLoc = eventLocationId
      ? eventClub?.locations?.find((l) => l.id === eventLocationId)
      : null;
    setEventLocation(matchedLoc?.name || eventClub?.name || null);

    const t = (league.teams || []).find((x: { id: string }) => x.id === teamId);
    if (t) {
      setTeam({ id: t.id, name: t.name, captainId: t.captain?.id || null, viceCaptainId: t.viceCaptain?.id || null });
      setRoster((t.players || []).map((tp: { player: PlayerLite }) => tp.player));
    }

    const ev = (round?.events || []).find((e: { id: string }) => e.id === eventId);
    setEventDate(ev?.date ?? null);
    setHostTeamId(ev?.hostTeamId ?? null);
    const opp = ev?.leagueTeams?.find((lt: { teamId: string }) => lt.teamId !== teamId);
    setOpponentTeam(opp ? { id: opp.team.id, name: opp.team.name } : null);
    // Pull the opponent's full roster IDs from the league team list so
    // the Friendly-pool widening can exclude them.
    if (opp) {
      type TeamShape = { id: string; players?: { playerId: string }[] };
      const oppFull = (league.teams as TeamShape[]).find((t) => t.id === opp.teamId);
      setOpponentRosterIds(new Set((oppFull?.players ?? []).map((p) => p.playerId)));
    } else {
      setOpponentRosterIds(new Set());
    }
    const ready: Record<string, boolean> = {};
    for (const lt of (ev?.leagueTeams ?? []) as { teamId: string; lineupReady?: boolean }[]) {
      ready[lt.teamId] = !!lt.lineupReady;
    }
    setReadyByTeam(ready);
    setLineupTotalLocked(!!(ev as { lineupTotalLocked?: boolean } | undefined)?.lineupTotalLocked);

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

  // Lock body scroll while the player picker overlay is open. Without
  // this, touch scrolls inside the sheet can bubble to the body, causing
  // the background page to scroll while the picker appears stuck.
  useEffect(() => {
    if (!picker) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [picker]);

  // Poll so each team sees the opponent's picks live. Pauses while a
  // save is in flight or the picker is open so we don't clobber mid-edit.
  usePollingRefresh(loadAll, 15000, !loading && !saving && !picker);

  // Per-game side derivation. MUST use the game's OWN team1Id — legacy
  // pre-create rows (rounds/events POST) stored team1Id/team2Id in
  // UI-selection order, while new toggle_slot rows use the alphabetical
  // canonical pair. A single global ourSide silently flipped the wants /
  // players column for half the games when the two conventions mixed.
  // Server's assign_players already derives side per-game; we do the
  // same here.
  const mySideForGame = useCallback((g: Game): 1 | 2 => {
    return team && g.team1Id === team.id ? 1 : 2;
  }, [team]);

  // Alphabetical canonical side — used when CREATING a fresh game
  // (synthetic optimistic row + server's new-row path both use the
  // sort-by-id pair). For existing rows we read each game's own team1Id
  // via mySideForGame.
  const myAlphabeticalSide: 1 | 2 | null = useMemo(() => {
    if (!team || !opponentTeam) return null;
    return team.id.localeCompare(opponentTeam.id) < 0 ? 1 : 2;
  }, [team, opponentTeam]);

  const wantsField = (g: Game): boolean => {
    const s = mySideForGame(g);
    return s === 1 ? g.team1Wants : g.team2Wants;
  };
  const oppWantsForGame = (g: Game): boolean => {
    const s = mySideForGame(g);
    return s === 1 ? g.team2Wants : g.team1Wants;
  };

  // Build (categoryId → slotNumber → game) map.
  const gameByKey = useMemo(() => {
    const m = new Map<string, Game>();
    for (const g of games) m.set(`${g.categoryId}:${g.slotNumber}`, g);
    return m;
  }, [games]);

  // Players belonging to this row's "our side" only — the opponent's
  // players are revealed below their column. Prefer the explicit `team`
  // field (1 | 2) on each game-player row; fall back to roster heuristics
  // for legacy rows where team is null (pre-migration data).
  const ourPlayersForGame = (g: Game): { id: string; name: string }[] => {
    const rosterIds = new Set(roster.map((p) => p.id));
    const side = mySideForGame(g);
    return g.gamePlayers
      .filter((gp) => {
        const t = (gp as { team?: number | null }).team;
        if (t === 1 || t === 2) return t === side;
        return rosterIds.has(gp.playerId);
      })
      .map((gp) => gp.player);
  };
  const oppPlayersForGame = (g: Game): { id: string; name: string }[] => {
    const oppRosterIds = opponentRosterIds;
    const ourRosterIds = new Set(roster.map((p) => p.id));
    const side = mySideForGame(g);
    return g.gamePlayers
      .filter((gp) => {
        const t = (gp as { team?: number | null }).team;
        if (t === 1 || t === 2) return t !== side;
        // Legacy null-team row:
        // - In OUR roster → ours, hide from opp column.
        // - In OPP roster → opp, show.
        // - Otherwise (friendly extra with unknown side): post-lock
        //   show as opp (data is settled; better to surface than hide).
        //   Pre-lock keep hidden to avoid the original "social player
        //   showed up as opponent" misclassification.
        if (ourRosterIds.has(gp.playerId)) return false;
        if (oppRosterIds.has(gp.playerId)) return true;
        return lineupTotalLocked;
      })
      .map((gp) => gp.player);
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
  // optimistic update locally. We re-sync silently in the background AFTER
  // the response — fire-and-forget, so the user's click handler resolves
  // immediately and the picker doesn't have to re-render against fresh
  // server data on every tap (which caused noticeable lag and visual
  // flicker when picking players in quick succession).
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
    // Reconcile with server truth in the background — don't block the
    // caller. The 15s polling refresh and the next user action will pick
    // up any missed reconciliation anyway.
    void loadAll();
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
    if (myAlphabeticalSide === null) return;

    // Snapshot for rollback.
    const snapshot = games;
    setGames((prev) => {
      const existing = prev.find((x) => x.categoryId === categoryId && x.slotNumber === slotNumber);
      // Derive the per-game wants field. EXISTING rows may use legacy
      // (non-alphabetical) team1/team2 order — read from THEIR team1Id.
      // NEW rows use alphabetical (matches server's create path).
      const rowSide: 1 | 2 = existing ? mySideForGame(existing) : myAlphabeticalSide;
      const wantsField: "team1Wants" | "team2Wants" = rowSide === 1 ? "team1Wants" : "team2Wants";
      const otherWantsField: "team1Wants" | "team2Wants" = rowSide === 1 ? "team2Wants" : "team1Wants";
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
          team1Wants: myAlphabeticalSide === 1, team2Wants: myAlphabeticalSide === 2,
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
    // Tag each new gamePlayer with the per-game side so the read-side
    // helpers (`ourPlayersForGame`) pick non-roster friendly extras up
    // as ours without waiting for the server refetch — otherwise the
    // newly-picked pill wouldn't appear instantly on the card.
    const snapshot = games;
    // Identify which ids are NEW vs the previous state so we can flash
    // just those pills on the match card for ~2s of UX feedback.
    const prevGame = games.find((g) => g.id === gameId);
    const prevSide = prevGame ? mySideForGame(prevGame) : null;
    const prevOurIds = prevGame
      ? prevGame.gamePlayers.filter((gp) => {
          const t = gp.team;
          if (t === 1 || t === 2) return t === prevSide;
          return roster.some((r) => r.id === gp.playerId);
        }).map((gp) => gp.playerId)
      : [];
    const newlyAdded = playerIds.filter((pid) => !prevOurIds.includes(pid));
    flashPlayers(newlyAdded);
    setGames((prev) => prev.map((g) => {
      if (g.id !== gameId) return g;
      // Drop any existing rows on our side (by team tag, with a roster
      // fallback for legacy rows) — mirrors the server-side delete.
      const side = mySideForGame(g);
      const ourRosterIds = new Set(roster.map((p) => p.id));
      const remaining = g.gamePlayers.filter((gp) => {
        const t = gp.team;
        if (t === 1 || t === 2) return t !== side;
        return !ourRosterIds.has(gp.playerId);
      });
      const ourPlayers = playerIds.map((pid) => {
        // Best-effort name lookup across roster + signups so the optimistic
        // pill shows the real name (not "…") even for non-roster picks.
        const fromRoster = roster.find((p) => p.id === pid);
        const fromSignup = signups.find((s) => s.playerId === pid)?.player;
        const name = fromRoster?.name ?? fromSignup?.name ?? "…";
        return { playerId: pid, team: side, player: { id: pid, name } };
      });
      return { ...g, gamePlayers: [...remaining, ...ourPlayers] };
    }));
    await postOptimistic(
      { action: "assign_players", gameId, playerIds },
      () => setGames(snapshot),
    );
  };

  const setReady = async (ready: boolean) => {
    if (!team) return;
    // Pre-lock validation: every ticked slot on OUR side must have the
    // right number of players (1 for singles, 2 for doubles/mix). Mixed
    // doubles further requires one of each gender.
    if (ready) {
      const problems: string[] = [];
      for (const g of games) {
        const ourWants = wantsField(g);
        if (!ourWants) continue;
        const cat = categories.find((c) => c.id === g.categoryId);
        if (!cat) continue;
        const ours = ourPlayersForGame(g);
        const needed = cat.format === "doubles" ? 2 : 1;
        if (ours.length === 0) {
          problems.push(`${cat.name} match ${g.slotNumber}: no players picked`);
          continue;
        }
        if (ours.length < needed) {
          problems.push(`${cat.name} match ${g.slotNumber}: only ${ours.length} of ${needed} players picked`);
          continue;
        }
        if (cat.gender === "mix" && cat.format === "doubles") {
          const ourFull = ours
            .map((p) => roster.find((r) => r.id === p.id))
            .filter((p): p is PlayerLite => !!p);
          const males = ourFull.filter((p) => p.gender === "M").length;
          const females = ourFull.filter((p) => p.gender === "F").length;
          if (!(males >= 1 && females >= 1)) {
            problems.push(`${cat.name} match ${g.slotNumber}: mixed doubles needs one ♂ and one ♀`);
          }
        }
      }
      if (problems.length > 0) {
        await alertDialog(
          `Fix these before locking:\n\n• ${problems.join("\n• ")}\n\nUntick the match or finish picking players.`,
          "Lineup not ready",
        );
        return;
      }
    }
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
    // If switching Friendly → Principal/League, drop any non-roster
    // players assigned on OUR side (they were only eligible while the
    // match was Friendly). The server enforces the same on assign,
    // but doing it here keeps the UI honest immediately.
    const rosterIdSet = new Set(roster.map((p) => p.id));
    const ourPlayerIds = target.gamePlayers
      .filter((gp) => rosterIdSet.has(gp.playerId))
      .map((gp) => gp.playerId);
    const oppPlayerEntries = target.gamePlayers.filter((gp) => !rosterIdSet.has(gp.playerId));
    const hadIneligibleOnOurSide =
      kind !== "extra" &&
      target.kind === "extra" &&
      target.gamePlayers.some((gp) => !rosterIdSet.has(gp.playerId) && !opponentRosterIds.has(gp.playerId));
    const snapshot = games;
    setGames((prev) => prev.map((g) => {
      if (g.id === gameId) {
        const cleaned = hadIneligibleOnOurSide
          ? {
              ...g,
              kind,
              gamePlayers: [
                ...oppPlayerEntries,
                ...g.gamePlayers.filter((gp) => rosterIdSet.has(gp.playerId)),
              ],
            }
          : { ...g, kind };
        return cleaned;
      }
      if (kind === "principal" && g.categoryId === target.categoryId && g.kind === "principal") {
        return { ...g, kind: "league" };
      }
      return g;
    }));
    await postOptimistic(
      { action: "set_kind", gameId, kind },
      () => setGames(snapshot),
    );
    // If we dropped non-roster players in the optimistic update, push
    // the new roster-only player list to the server too — set_kind
    // alone doesn't touch gamePlayers.
    if (hadIneligibleOnOurSide) {
      void assignPlayers(gameId, ourPlayerIds);
    }
  };


  // Whether opponent rosters/sign-ups are revealed. The reveal is now
  // LATCHED on the event-level `lineupTotalLocked` field: once both
  // teams hit lineupReady=true the latch fires permanently. After
  // that, opponent data stays visible even if a team unlocks for a
  // joint edit. Pre-latch we fall back to the legacy "both currently
  // ready" check so any historical events without the new column
  // still work. League organizers/admin always get full data from
  // the server regardless.
  const bothReady = lineupTotalLocked
    || !!(team && opponentTeam && readyByTeam[team.id] && readyByTeam[opponentTeam.id]);
  // Only the home team's captain/vice (or a league organizer / app admin)
  // may set scheduledAt + courtNum on each game.
  const isHostCaptain = !!(team && hostTeamId === team.id && isTeamLeader);
  const canSchedule = isHostCaptain || isOrganizer;
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
  const buildPools = (cat: Category, kind: "principal" | "league" | "extra" = "principal") => {
    const matchesGender = (g: string | null | undefined) => {
      if (cat.gender === "male") return g === "M";
      if (cat.gender === "female") return g === "F";
      return true;
    };
    const rosterById = new Map(roster.map((p) => [p.id, p]));
    const recommended: PlayerLite[] = [];
    const allSignups: PlayerLite[] = [];
    const opponentSignups: PlayerLite[] = [];
    // Friendly-only pool: anyone signed up to the event who isn't on
    // our roster AND isn't on the opposing team's roster. Empty when
    // the slot is Principal/League (those require roster-only).
    const friendlyExtras: PlayerLite[] = [];
    for (const s of signups) {
      if (!matchesGender(s.player.gender)) continue;
      const pl: PlayerLite = { ...s.player, gender: s.player.gender ?? null };
      const onRoster = rosterById.has(s.playerId);
      const onOpponentRoster = opponentRosterIds.has(s.playerId);
      if (onRoster) {
        allSignups.push(pl);
        const pref = s.signupPreferences?.[cat.id]?.level;
        if (pref === "prefer" || pref === "ok") recommended.push(pl);
      } else if (onOpponentRoster) {
        if (bothReady) opponentSignups.push(pl);
      } else if (kind === "extra") {
        // Non-roster signup, not on either team — eligible for friendly.
        friendlyExtras.push(pl);
      }
    }
    const filteredRoster = roster.filter((p) => matchesGender(p.gender));
    const byName = (a: PlayerLite, b: PlayerLite) => a.name.localeCompare(b.name);
    return {
      recommended: recommended.sort(byName),
      allSignups: allSignups.sort(byName),
      opponentSignups: opponentSignups.sort(byName),
      roster: filteredRoster.sort(byName),
      friendlyExtras: friendlyExtras.sort(byName),
    };
  };

  const back = () => router.push(`/events/${eventId}`);

  // Header content. Rendered immediately (even during initial load) so the
  // user sees the league/round context before the body resolves. Fields
  // fill in as loadAll() populates state.
  const headerTitle = (() => {
    const round = roundName || (roundNumber ? `Round ${roundNumber}` : null);
    if (leagueName && round) return `${leagueName} - ${round}`;
    return leagueName || round || "Lineup";
  })();
  const headerMeta = (() => {
    const dateStr = eventDate
      ? new Date(eventDate).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
      : null;
    const parts = [eventLocation, dateStr].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : undefined;
  })();
  const headerEl = (
    <AppHeader
      variant="hero-sub"
      title={headerTitle}
      meta={headerMeta}
      back={{ label: "Back to event", onClick: back }}
    />
  );

  if (loading) {
    return (
      <>
        {headerEl}
        <div className="text-sm text-muted py-8 text-center">Loading lineup…</div>
      </>
    );
  }
  if (!team || !canEdit) {
    return (
      <>
        {headerEl}
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
      {headerEl}
    <div className="space-y-2">

      <div className={`${frameClass} p-4 space-y-2`}>
        {/* "vs {opponent}" context — used to live in the header meta, but
            the meta now carries location + date. Keep a small line here
            so the team-vs-opponent framing stays visible. */}
        {(team || opponentTeam) && (
          <div className="text-[11px] text-muted">
            {team?.name}
            {team && opponentTeam && " vs "}
            {opponentTeam?.name}
          </div>
        )}

        {/* Lineup-lock state. Five distinct UI states:
              1. Pre-reveal, nobody ready → "Mark as done when final."
              2. Pre-reveal, I'm ready, opponent isn't → "Waiting for {opp}"
              3. Both ready → reveal-latch fires → "Lineups revealed and locked."
              4. Post-reveal, both unlocked → "Joint editing — mutual unlock."
              5. Post-reveal, one side unlocked → "waiting on the
                 opposing team to unlock for joint editing"
            The latched `lineupTotalLocked` distinguishes pre/post-reveal. */}
        {(() => {
          const myReady = team ? !!readyByTeam[team.id] : false;
          const oppReady = opponentTeam ? !!readyByTeam[opponentTeam.id] : false;
          const totalLocked = lineupTotalLocked;
          const bothReady = myReady && oppReady;
          const bothUnlocked = !myReady && !oppReady;

          let bg = "bg-gray-50 border-border";
          let primary = "Mark as done when your lineup is final.";
          if (bothReady) {
            bg = "bg-emerald-50 border-emerald-200";
            primary = totalLocked
              ? "Lineups revealed and locked."
              : "Both teams done picking — lineups revealed.";
          } else if (totalLocked) {
            bg = bothUnlocked
              ? "bg-blue-50 border-blue-200"
              : "bg-amber-50 border-amber-200";
            primary = bothUnlocked
              ? "Joint editing open — both teams unlocked."
              : myReady
                ? `Waiting on ${opponentTeam?.name || "the opposing team"} to unlock for joint editing.`
                : `waiting on ${opponentTeam?.name || "the opposing team"} to unlock for joint editing`;
          } else if (myReady) {
            bg = "bg-amber-50 border-amber-200";
            primary = `Waiting for ${opponentTeam?.name || "opponent"}…`;
          }

          return (
            <div className={`mt-1 rounded-lg border p-2 flex items-center justify-between gap-2 ${bg}`}>
              <div className="flex-1 text-xs">
                <div className="font-medium">{primary}</div>
                <div className="text-[10px] text-muted">
                  {opponentTeam?.name || "Opponent"}: {oppReady ? "✓ locked" : "unlocked"}
                  {totalLocked && <span className="ml-2 text-emerald-700">· lineups revealed</span>}
                </div>
              </div>
              <button
                type="button"
                disabled={saving || !isTeamLeader}
                onClick={() => setReady(!myReady)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap ${
                  myReady ? "bg-gray-200 text-foreground" : "bg-action text-white"
                } disabled:opacity-50`}
              >{myReady ? "Re-open" : "Lock Team Lineup"}</button>
            </div>
          );
        })()}

        {errorMsg && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">{errorMsg}</div>
        )}
        <p className="text-[11px] text-muted">
          Tick the slots your team wants to play. Then assign your players. The opponent sees the same grid and ticks their own. One game per category should be marked as <span className="font-medium">Principal</span> — that&apos;s the match that counts for category standings.
        </p>
        {/* Event-wide cap on Principal + League matches. Friendly
            matches don't count against the cap. Count line is always
            shown; the warning is on its own row only when at cap. */}
        {maxMatchesPerEvent !== null && (() => {
          const used = games.filter((g) => g.kind === "principal" || g.kind === "league").length;
          const atCap = used >= maxMatchesPerEvent;
          return (
            <div className={`text-[11px] rounded px-2 py-1 space-y-0.5 ${atCap ? "text-amber-700 bg-amber-50 border border-amber-200" : "text-muted bg-gray-50 border border-border"}`}>
              <div>
                Principal + League matches: <span className="font-bold">{used} / {maxMatchesPerEvent}</span>
              </div>
              {atCap && (
                <div>
                  Cap reached. You can however add <span className="font-bold">Friendly</span> matches.
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Single Expand/Collapse-all toggle for category cards. Mirrors
          the rounds/standings pattern: imperatively flips each
          <details data-category-card> open attribute. */}
      {categories.length > 0 && (
        <div className="flex justify-end mb-1">
          <button
            type="button"
            onClick={() => {
              const els = document.querySelectorAll<HTMLDetailsElement>("[data-category-card]");
              const next = categoriesAllCollapsed; // currently collapsed → open all
              els.forEach((el) => { el.open = next; });
              setCategoriesAllCollapsed(!next);
            }}
            className="text-xs text-muted hover:text-foreground flex items-center gap-1 px-2 py-1"
            title={categoriesAllCollapsed ? "Expand all" : "Collapse all"}
          >
            <span className="text-[10px]">{categoriesAllCollapsed ? "▼" : "▲"}</span>
            {categoriesAllCollapsed ? "Expand all" : "Collapse all"}
          </button>
        </div>
      )}

      {categories.map((cat) => {
        const max = cat.maxPerEvent ?? 1;
        const existingSlots = games
          .filter((g) => g.categoryId === cat.id)
          .map((g) => g.slotNumber);
        const maxExisting = Math.max(0, ...existingSlots);
        // Base rows: at least 1 so every category lights up with its first
        // match row pre-displayed (no need to tap "+ Add match" before
        // starting). extraSlots can be NEGATIVE: the captain can ✕ that
        // first row away — the category card stays, the slot disappears,
        // and "+ Add match" brings it back. Existing games (maxExisting)
        // floor the count so a row with a real game can't be hidden via ✕.
        const baseRows = Math.max(maxExisting, 1);
        const visibleSlotCount = Math.min(
          max,
          Math.max(maxExisting, baseRows + (extraSlots[cat.id] || 0)),
        );
        const slots = Array.from({ length: visibleSlotCount }, (_, i) => i + 1);
        const canAddMore = visibleSlotCount < max;
        // Principal-per-category cap: only ONE principal per category in
        // an event. Once a principal exists, the toggle for other slots
        // is blocked (host can demote it first to flip another).
        const principalCount = games.filter((g) => g.categoryId === cat.id && g.kind === "principal").length;

        return (
          <details key={cat.id} data-category-card open className={`${frameClass} shadow-sm border-l-4 border-l-action/60 group overflow-hidden`}>
            <summary className="flex items-baseline justify-between gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 list-none">
              <div className="flex items-center gap-2">
                <span className="text-muted text-xs group-open:rotate-90 transition-transform">›</span>
                <div className="text-base font-bold">{cat.name}</div>
              </div>
              <div className="flex items-baseline gap-2">
                <div className="text-[11px] text-muted">{cat.format} · max {max}</div>
                {canAddMore && !ourLocked && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setExtraSlots((prev) => ({ ...prev, [cat.id]: (prev[cat.id] || 0) + 1 }));
                    }}
                    className="text-[11px] text-action font-medium hover:underline disabled:opacity-50"
                  >+ Add match</button>
                )}
              </div>
            </summary>
            <div className="px-3 pb-3 pt-1.5 space-y-2 border-t border-border/70">

            {slots.length === 0 && (
              <p className="text-[11px] text-muted italic">No matches in this Event.</p>
            )}
            {slots.map((slotNum) => {
              const g = gameByKey.get(`${cat.id}:${slotNum}`);
              const ourWants = !!(g && wantsField(g));
              const oppWants = !!(g && oppWantsForGame(g));
              const ourPlayers = g ? ourPlayersForGame(g) : [];
              const oppPlayers = g ? oppPlayersForGame(g) : [];
              const locked = !!g?.winnerId;
              const isPrincipal = g?.kind === "principal";

              return (
                <div key={slotNum} className={`relative border rounded-lg p-2 ${isPrincipal ? "border-emerald-300 bg-emerald-50/40" : "border-border"}`}>
                  {/* Top-right red ✕: hide this match row. Works whenever
                      the captain hasn't assigned any of OUR players yet —
                      including a ticked Match 1 that hasn't been filled.
                      Untickes if we'd ticked, then hides the row. If the
                      opponent is still up for this slot the row will
                      stay visible (driven by the existing game). The
                      category card itself always stays so "+ Add match"
                      can bring the row back. */}
                  {!locked && !ourLocked && ourPlayers.length === 0 && oppPlayers.length === 0 && (
                    <button
                      type="button"
                      aria-label="Remove this match"
                      title={g ? "Remove this match from the event" : "Hide this match row"}
                      onClick={async () => {
                        // Three paths:
                        //  1. No game row yet → just shrink the local visible-slots count.
                        //  2. Game exists AND we're authorised to schedule → DELETE
                        //     the game on the server. Removes it for both teams.
                        //  3. Game exists, away-team captain (no schedule auth) → only
                        //     un-tick our wants; the row may persist if the opponent
                        //     still wants it. Matches the previous behaviour.
                        if (!g) {
                          setExtraSlots((prev) => ({ ...prev, [cat.id]: (prev[cat.id] || 0) - 1 }));
                          return;
                        }
                        if (canSchedule) {
                          const ok = await confirmDialog({
                            title: `Remove ${cat.name} match ${slotNum}?`,
                            message: "This deletes the match from the event for both teams.",
                            confirmText: "Remove",
                            danger: true,
                          });
                          if (!ok) return;
                          setSaving(true);
                          try {
                            const r = await fetch(`/api/leagues/${id}/events/${eventId}/games/${g.id}`, { method: "DELETE" });
                            if (!r.ok) {
                              const d = await r.json().catch(() => ({}));
                              await alertDialog(d.error || "Failed to remove match");
                              return;
                            }
                            setGames((prev) => prev.filter((x) => x.id !== g.id));
                            setExtraSlots((prev) => ({ ...prev, [cat.id]: Math.min(0, (prev[cat.id] || 0) - 1) }));
                          } finally {
                            setSaving(false);
                          }
                        } else {
                          const ok = await confirmDialog({
                            title: `Remove ${cat.name} match ${slotNum}?`,
                            message: oppWants
                              ? "This clears your tick. The opponent has also ticked, so the match stays on the schedule until they untick too."
                              : "This clears your tick. The match will be removed from the event.",
                            confirmText: "Remove",
                            danger: true,
                          });
                          if (!ok) return;
                          if (ourWants) toggleSlot(cat.id, slotNum, false);
                          setExtraSlots((prev) => ({ ...prev, [cat.id]: (prev[cat.id] || 0) - 1 }));
                        }
                      }}
                      className="absolute -top-2 -right-2 z-10 bg-white border border-red-200 text-danger hover:bg-red-50 rounded-full w-5 h-5 flex items-center justify-center text-[11px] leading-none shadow-sm disabled:opacity-50"
                      disabled={saving}
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
                    {g && (() => {
                      // Three kinds via a native <select>. Underlying
                      // values: principal | league | extra (labelled
                      // "Friendly" in the UI). Only HOST captain /
                      // league admin / app admin can flip — away captain
                      // sees a read-only chip.
                      const canFlipKind = canSchedule && !locked && !ourLocked;
                      // Per-category cap: only ONE principal allowed.
                      const promoteBlocked = g.kind !== "principal" && principalCount >= 1;
                      // Event-wide cap: Principal + League ≤ maxMatchesPerEvent.
                      // Friendly is unlimited (doesn't count toward the cap).
                      // Switching to a "counting" kind is blocked when adding
                      // would push the total over the cap.
                      const countingNow = games.filter((gg) => gg.kind === "principal" || gg.kind === "league").length;
                      const currentCounts = g.kind === "principal" || g.kind === "league";
                      const wouldGoOverCap = (kind: "principal" | "league" | "extra") => {
                        if (maxMatchesPerEvent === null) return false;
                        const future = countingNow + (kind === "principal" || kind === "league" ? 1 : 0) - (currentCounts ? 1 : 0);
                        return future > maxMatchesPerEvent;
                      };
                      const kinds: { key: "principal" | "league" | "extra"; label: string }[] = [
                        { key: "principal", label: "Principal" },
                        { key: "league",    label: "League" },
                        { key: "extra",     label: "Friendly" },
                      ];
                      const colorClass =
                        g.kind === "principal" ? "border-emerald-400 text-emerald-700 bg-emerald-50"
                          : g.kind === "league" ? "border-blue-400 text-blue-700 bg-blue-50"
                          : "border-gray-300 text-muted bg-gray-50";
                      if (!canFlipKind) {
                        // Away-team view: read-only chip. Tooltip
                        // explains that the host controls the setting,
                        // so any disagreement is a conversation, not a
                        // UI race.
                        const hostName = hostTeamId === team?.id
                          ? team?.name
                          : (opponentTeam?.id === hostTeamId ? opponentTeam?.name : "the host");
                        return (
                          <span
                            title={`The hosting team (${hostName ?? "host"}) controls this value. Talk with them to agree.`}
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${colorClass}`}
                          >
                            {kinds.find((k) => k.key === g.kind)?.label ?? g.kind}
                          </span>
                        );
                      }
                      return (
                        <select
                          value={g.kind}
                          disabled={saving}
                          title={`Discuss with ${opponentTeam?.name || "the away team"} before changing.`}
                          onChange={(e) => {
                            const next = e.target.value as "principal" | "league" | "extra";
                            if (next === g.kind) return;
                            if (next === "principal" && promoteBlocked) {
                              void alertDialog(
                                "Another match in this category is already Principal. Change that one to League or Friendly first.",
                                "Only one Principal per category",
                              );
                              return;
                            }
                            if (wouldGoOverCap(next)) {
                              void alertDialog(
                                `This match-day allows at most ${maxMatchesPerEvent} Principal + League matches combined. Switch one of the existing ones to Friendly first to free up a slot.`,
                                "Match-day cap reached",
                              );
                              return;
                            }
                            setKind(g.id, next);
                          }}
                          className={`text-[10px] font-medium border rounded-full pl-2 pr-5 py-0.5 appearance-none cursor-pointer ${colorClass}`}
                          style={{
                            backgroundImage:
                              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
                            backgroundRepeat: "no-repeat",
                            backgroundPosition: "right 4px center",
                          }}
                        >
                          {kinds.map((k) => (
                            <option key={k.key} value={k.key}>{k.label}</option>
                          ))}
                        </select>
                      );
                    })()}
                  </div>

                  {/* Schedule + format — read-only display for everyone.
                      Time and court are managed from the Matches page
                      (where matches are organised by court / start time).
                      The host captain CAN override the format here. */}
                  {g && (() => {
                    const timeStr = g.scheduledAt
                      ? (() => {
                          const d = new Date(g.scheduledAt);
                          if (isNaN(d.getTime())) return null;
                          return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
                        })()
                      : null;
                    const effectiveScoring = g.scoringFormatOverride ?? cat.scoringFormat;
                    const effectiveWinBy = g.winByOverride ?? cat.winBy;
                    const hasFormatOverride = g.scoringFormatOverride != null || g.winByOverride != null;
                    const edit = formatEdits[g.id];
                    const openEdit = () => {
                      setFormatEdits((prev) => ({
                        ...prev,
                        [g.id]: { scoringFormat: effectiveScoring, winBy: effectiveWinBy },
                      }));
                    };
                    const closeEdit = () => {
                      setFormatEdits((prev) => {
                        const out = { ...prev };
                        delete out[g.id];
                        return out;
                      });
                    };
                    const saveEdit = async () => {
                      if (!edit) return;
                      setSavingFormatId(g.id);
                      try {
                        const scoringFormatOverride = edit.scoringFormat === cat.scoringFormat ? null : edit.scoringFormat;
                        const winByOverride = edit.winBy === cat.winBy ? null : edit.winBy;
                        const r = await fetch(`/api/leagues/${id}/events/${eventId}/games/${g.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ scoringFormatOverride, winByOverride }),
                        });
                        if (!r.ok) {
                          const d = await r.json().catch(() => ({}));
                          await alertDialog(d.error || "Failed to save format override");
                          return;
                        }
                        // Optimistic local update + close the panel.
                        setGames((prev) => prev.map((x) => x.id === g.id ? { ...x, scoringFormatOverride, winByOverride } : x));
                        closeEdit();
                      } finally {
                        setSavingFormatId(null);
                      }
                    };
                    return (
                      <div className="mt-2 text-[11px] text-muted flex items-center gap-2 flex-wrap">
                        <span className={hasFormatOverride ? "text-violet-700 font-medium" : ""}>
                          {formatLabel(effectiveScoring, effectiveWinBy)}
                        </span>
                        {canSchedule && !edit && !g.winnerId && (
                          <button
                            type="button"
                            onClick={openEdit}
                            className="text-[10px] text-action font-medium hover:underline"
                          >
                            {hasFormatOverride ? "Change override" : "Override format"}
                          </button>
                        )}
                        {edit && (
                          <span className="inline-flex flex-wrap items-center gap-1 ml-1">
                            <select
                              value={edit.scoringFormat}
                              onChange={(e) => setFormatEdits((prev) => ({ ...prev, [g.id]: { ...edit, scoringFormat: e.target.value } }))}
                              className="border border-border rounded px-1 py-0.5 text-[11px] bg-white"
                            >
                              {FORMAT_SCORING_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                            </select>
                            <select
                              value={edit.winBy}
                              onChange={(e) => setFormatEdits((prev) => ({ ...prev, [g.id]: { ...edit, winBy: e.target.value } }))}
                              className="border border-border rounded px-1 py-0.5 text-[11px] bg-white"
                            >
                              {FORMAT_WINBY_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                            </select>
                            {hasFormatOverride && (
                              <button
                                type="button"
                                onClick={async () => {
                                  setSavingFormatId(g.id);
                                  try {
                                    const r = await fetch(`/api/leagues/${id}/events/${eventId}/games/${g.id}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ scoringFormatOverride: null, winByOverride: null }),
                                    });
                                    if (!r.ok) { const d = await r.json().catch(() => ({})); await alertDialog(d.error || "Failed"); return; }
                                    setGames((prev) => prev.map((x) => x.id === g.id ? { ...x, scoringFormatOverride: null, winByOverride: null } : x));
                                    closeEdit();
                                  } finally { setSavingFormatId(null); }
                                }}
                                disabled={savingFormatId === g.id}
                                className="text-[10px] text-muted hover:text-danger px-1"
                              >Clear</button>
                            )}
                            <button
                              type="button"
                              onClick={saveEdit}
                              disabled={savingFormatId === g.id}
                              className="text-[10px] text-white bg-action rounded-md px-2 py-0.5 font-semibold hover:brightness-110 disabled:opacity-50"
                            >{savingFormatId === g.id ? "Saving…" : "Save"}</button>
                            <button
                              type="button"
                              onClick={closeEdit}
                              className="text-[10px] text-muted hover:text-foreground px-1"
                            >Cancel</button>
                          </span>
                        )}
                        {/* Time + court pinned to the end of the row (right side
                            on desktop, wraps below on narrow screens) so the row
                            reads format-first, schedule-last. */}
                        {(timeStr || g.courtNum != null) && (
                          <span className="ml-auto inline-flex items-center gap-2 text-muted">
                            {timeStr && <span>⏰ {timeStr}</span>}
                            {g.courtNum != null && <span>Court {g.courtNum}</span>}
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  {ourWants && g && (
                    <div className="mt-2 space-y-1">
                      <div className="text-[10px] uppercase tracking-wide text-muted">Your players</div>
                      {/* Pills row + a right-anchored action button. Pinning
                          the button to the right with ml-auto keeps it in
                          a consistent spot across all match cards, no
                          matter how few/many pills are rendered. */}
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                          {ourPlayers.map((p) => {
                            const flashing = recentlyChangedPids.has(p.id);
                            return (
                              <span
                                key={p.id}
                                className={`px-2 py-1 rounded-full text-xs transition-all duration-500 ${flashing ? "bg-action text-white ring-2 ring-action/40 shadow-sm" : "bg-action/10 text-foreground"}`}
                              >{p.name}</span>
                            );
                          })}
                        </div>
                        <button
                          type="button"
                          disabled={saving || locked || ourLocked}
                          onClick={() => setPicker({ categoryId: cat.id, slotNumber: slotNum, which: ourPlayers.length === 0 || !isDoubles(cat) ? 1 : 2 })}
                          className="shrink-0 ml-auto text-xs text-action font-medium px-2 py-1 rounded-full border border-dashed border-action/40 hover:bg-action/5 disabled:opacity-50"
                        >
                          {ourPlayers.length === 0 ? "+ Pick" : isDoubles(cat) && ourPlayers.length < 2 ? "+ Partner" : "Change Player(s)"}
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
                  {/* Cross-team wants summary. Schema stores team1Wants
                      and team2Wants independently; each team only ever
                      toggles its OWN field. The displayed message
                      clarifies who has ticked. */}
                  {!ourWants && !oppWants && (
                    <p className="text-[11px] text-muted mt-1">Neither team has ticked this slot yet.</p>
                  )}
                  {!ourWants && oppWants && (
                    <p className="text-[11px] text-amber-700 mt-1">{opponentTeam?.name ?? "Opponent"} wants to play this match — tick to confirm.</p>
                  )}
                  {ourWants && !oppWants && (
                    <p className="text-[11px] text-muted mt-1">{opponentTeam?.name ?? "Opponent"} hasn&apos;t ticked yet — they can see you want to play this match.</p>
                  )}
                </div>
              );
            })}

            </div>
          </details>
        );
      })}

      {/* Player picker overlay */}
      {picker && (() => {
        const cat = categories.find((c) => c.id === picker.categoryId);
        if (!cat) return null;
        const g = gameByKey.get(`${picker.categoryId}:${picker.slotNumber}`);
        if (!g) return null;
        const pools = buildPools(cat, g.kind);
        const currentIds = ourPlayersForGame(g).map((p) => p.id);
        // Mixed doubles: after the first pick, hide players of the same
        // gender — the second slot must be the other gender. Looks up the
        // first picked player's gender across all candidate pools.
        const isMixedDoubles = isDoubles(cat) && cat.gender === "mix";
        const firstPick = currentIds[0]
          ? [...pools.recommended, ...pools.allSignups, ...pools.roster, ...pools.opponentSignups, ...pools.friendlyExtras].find((p) => p.id === currentIds[0])
          : null;
        const excludeGender = isMixedDoubles && firstPick?.gender ? firstPick.gender : null;
        // Always hide already-picked players from the pools below — they
        // live in the "Selected" panel at the top. Also drops same-gender
        // candidates when this is a mixed-doubles second-slot scenario.
        const searchQ = pickerSearch.trim().toLowerCase();
        const filterMix = <T extends PlayerLite>(arr: T[]): T[] => {
          return arr.filter((p) => {
            if (currentIds.includes(p.id)) return false;
            if (excludeGender && p.gender === excludeGender) return false;
            if (searchQ && !p.name.toLowerCase().includes(searchQ)) return false;
            return true;
          });
        };
        const close = () => setPicker(null);
        const choose = async (pid: string) => {
          // Singles → replace. Doubles → toggle in/out. When 2 are already
          // picked AND the user taps an UNSELECTED player, bail with a
          // hint instead of silently replacing the oldest pick — the
          // implicit-replace was confusing ("which one did I lose?").
          let next: string[];
          if (!isDoubles(cat)) {
            next = [pid];
          } else if (currentIds.includes(pid)) {
            // Tap a selected player → deselect. Close the picker so the
            // captain sees the slot update and can re-open it to add a
            // replacement explicitly.
            next = currentIds.filter((x) => x !== pid);
            setPicker(null);
            void assignPlayers(g.id, next);
            return;
          } else if (currentIds.length >= 2) {
            const playerName = pools.roster.find((p) => p.id === pid)?.name
              || pools.allSignups.find((p) => p.id === pid)?.name
              || "Player";
            await alertDialog(
              `Tap one of the already-picked players to remove them first, then pick ${playerName}.`,
              "Both slots full",
            );
            return;
          } else {
            next = [...currentIds, pid];
          }
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
            // Pass returnTo so after saving the captain returns to the
            // lineup picker instead of dropping to the public event page.
            const returnTo = encodeURIComponent(`/leagues/${id}/events/${eventId}/lineup/${teamId}`);
            router.push(`/events/${eventId}/sign-up?for=${pid}&returnTo=${returnTo}`);
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
          // Auto-close once the slot is fully filled: 1 for singles, 2 for
          // doubles. For doubles still building toward 2, leave the picker
          // open so the captain can pick the partner.
          const slotComplete = !isDoubles(cat) ? next.length >= 1 : next.length >= 2;
          if (slotComplete) setPicker(null);
          // Fire and forget — the optimistic update inside assignPlayers
          // has already flipped the UI. Awaiting here would block the
          // close above behind the network round-trip.
          void assignPlayers(g.id, next);
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
                  {p.gender && <span className={`text-xs shrink-0 ${p.gender === "F" ? "text-pink-500" : "text-blue-500"}`}>{p.gender === "F" ? "♀" : "♂"}</span>}
                  <span className={`flex-1 text-left text-sm ${cantCome ? "line-through text-muted" : ""}`}>{p.name}</span>
                  {cantCome && <span className="text-[10px] text-rose-600">unavailable</span>}
                  {noPref && !cantCome && <span className="text-[10px] text-amber-600">said &ldquo;no&rdquo;</span>}
                </RowTag>
              );
            })}
          </div>
        );

        return (
          <div
            className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center overscroll-contain"
            onClick={close}
            // Block touchmoves on the dim layer so swipes outside the
            // sheet don't scroll the page beneath. The inner sheet stops
            // propagation so its own touchmoves still scroll it.
            onTouchMove={(e) => e.preventDefault()}
          >
            <div
              className="bg-card w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-border p-3 max-h-[85vh] overflow-y-auto overscroll-contain flex flex-col"
              onClick={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
            >
              {/* Sticky header that spans edge-to-edge (cancels the
                  parent's p-3) so scrolled content can't bleed through
                  the padded gap above. */}
              <div className="sticky top-0 z-20 bg-card -mx-3 -mt-3 px-3 pt-3 pb-2 mb-2 border-b border-border/60 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Pick player — {cat.name} match {picker.slotNumber}</h3>
                <button onClick={close} className="text-muted text-sm">Done</button>
              </div>
              {/* Live "Selected" summary at the top of the sheet so the
                  user gets instant feedback after each tap — instead of
                  having to glance behind the modal to verify. Includes
                  per-pick remove (×) and a Clear all when ≥1 picked. */}
              {(() => {
                const slotCap = isDoubles(cat) ? 2 : 1;
                const selectedPlayers = currentIds
                  .map((pid) =>
                    [...pools.recommended, ...pools.allSignups, ...pools.roster].find((p) => p.id === pid)
                      ?? ourPlayersForGame(g).find((p) => p.id === pid) // fallback if pool doesn't include them
                      ?? null,
                  )
                  .filter((p): p is PlayerLite => !!p);
                return (
                  <div className="mb-2 rounded-lg border border-border bg-gray-50 px-2 py-1.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase tracking-wide text-muted">
                        Selected ({selectedPlayers.length}/{slotCap})
                      </span>
                      {selectedPlayers.length > 0 && (
                        <button
                          type="button"
                          onClick={() => { setPicker(null); void assignPlayers(g.id, []); }}
                          className="text-[11px] text-danger font-medium hover:underline"
                        >Clear all</button>
                      )}
                    </div>
                    {selectedPlayers.length === 0 ? (
                      <div className="text-[11px] text-muted italic">No players picked yet — tap a name below.</div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedPlayers.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              const next = currentIds.filter((x) => x !== p.id);
                              setPicker(null);
                              void assignPlayers(g.id, next);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-action/10 text-foreground text-xs border border-action/30 hover:bg-action/15"
                            title="Tap to remove"
                          >
                            <span>{p.name}</span>
                            {p.gender && (
                              <span className={p.gender === "F" ? "text-pink-500" : "text-blue-500"}>
                                {p.gender === "F" ? "♀" : "♂"}
                              </span>
                            )}
                            <span className="text-muted">×</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              {excludeGender && (
                <div className="text-[10px] text-muted bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
                  Mixed match — partner must be {excludeGender === "M" ? "♀ female" : "♂ male"}.
                </div>
              )}
              {g.kind === "extra" && (
                <div className="text-[10px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1 mb-2">
                  Friendly match — anyone signed up to the event can play (except the opposing team&apos;s roster).
                </div>
              )}
              {/* Name-search across all pools. Empty = no filter. */}
              <div className="relative mb-2">
                <input
                  type="text"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Search player..."
                  className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm bg-white"
                />
                {pickerSearch && (
                  <button
                    type="button"
                    onClick={() => setPickerSearch("")}
                    aria-label="Clear search"
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-muted hover:text-foreground px-2 text-sm"
                  >✕</button>
                )}
              </div>
              <div className="space-y-3">
                <Section title="Recommended" hint="signed up + prefer/ok" players={filterMix(pools.recommended)} />
                {bothReady && pools.opponentSignups.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Section title={`${team!.name} sign-ups`} players={filterMix(pools.allSignups.filter((p) => !pools.recommended.some((r) => r.id === p.id)))} />
                    <Section title={`${opponentTeam?.name || "Opponent"} sign-ups`} players={filterMix(pools.opponentSignups)} readOnly />
                  </div>
                ) : (
                  <Section title="All sign-ups" players={filterMix(pools.allSignups.filter((p) => !pools.recommended.some((r) => r.id === p.id)))} />
                )}
                <Section title="Roster" players={filterMix(pools.roster.filter((p) => !pools.allSignups.some((s) => s.id === p.id)))} />
                {g.kind === "extra" && pools.friendlyExtras.length > 0 && (
                  <Section title="Other event sign-ups" hint="friendly only" players={filterMix(pools.friendlyExtras)} />
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
    </>
  );
}
