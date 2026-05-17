"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useViewRole, hasRole } from "@/components/RoleToggle";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ClearInput } from "@/components/ClearInput";
import { useConfirm } from "@/components/ConfirmDialog";
import { useHideBottomNav } from "@/lib/hooks";
import { frameClass } from "@/components/Card";
import { LoadingState } from "@/components/LoadingState";
import { COUNTRIES } from "@/lib/countries";
import { withInstallTip, personalClaimUrl } from "@/lib/inviteShare";
import { ShareInviteModal } from "@/components/ShareInviteModal";
import { nameMatchesSearch } from "@/lib/searchUtil";
import { copyText } from "@/lib/clipboard";
import { WhatsAppIcon } from "@/components/WhatsAppIcon";
import { UnclaimedIcon } from "@/components/UnclaimedIcon";

interface PlayerClub {
  id: string;
  name: string;
  emoji: string;
  role: string;
}

interface PlayerLeagueTeam {
  teamId: string;
  teamName: string;
  leagueId: string;
  leagueName: string;
  season: string | null;
}

interface Player {
  id: string;
  name: string;
  emoji: string;
  email?: string | null;
  hasAccount: boolean;
  rating: number;
  wins: number;
  losses: number;
  photoUrl?: string | null;
  gender?: string | null;
  phone?: string | null;
  role?: string;
  canCreateLeagues?: boolean;
  canCreateClubs?: boolean;
  country?: string | null;
  duprRating?: number | null;
  clubs?: PlayerClub[];
  leagueTeams?: PlayerLeagueTeam[];
  _count?: { matchPlayers: number };
  invitesSent?: number;
  lastInvitedAt?: string | null;
}

// Short-name a league: take the first two whitespace-separated tokens.
// e.g. "I Liga Interclubes Pickleball Zona Centro - Portugal" → "I Liga"
function shortLeagueName(name: string): string {
  const tokens = name.trim().split(/\s+/);
  return tokens.slice(0, 2).join(" ");
}

export default function PlayersPage() {
  const { data: session } = useSession();
  const { confirm: confirmDialog, alert: alertDialog } = useConfirm();
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [inviteShare, setInviteShare] = useState<{ playerId: string; message: string; phone: string | null; title: string; emailSubject: string } | null>(null);

  useHideBottomNav(!!editingId);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editGender, setEditGender] = useState<string | null>(null);
  const [editPhone, setEditPhone] = useState("");
  const [editCountry, setEditCountry] = useState<string>("");
  const [genderFilter, setGenderFilter] = useState<string | null>(null);
  const [clubFilter, setClubFilter] = useState<string>("");
  // Country filter — defaults to the signed-in user's country (set when
  // the session loads). "" means "all countries" — handy for app admins
  // and people who want to browse the global pool.
  const [countryFilter, setCountryFilter] = useState<string>("");
  // Tracks whether we've applied the session-default once. Without this
  // flag the user couldn't reset the filter to "All": every render that
  // saw a session country would overwrite their choice.
  const [countryDefaultApplied, setCountryDefaultApplied] = useState(false);
  // App-admin filter: when set, restrict the list to accounts activated
  // (self-registered OR claimed-via-invite) in that window. Driven by
  // the "new users" stat links above the search field.
  const [activatedSinceFilter, setActivatedSinceFilter] = useState<"24h" | "7d" | null>(null);
  // Per-admin new-user counts shown above the list. Null until first
  // fetch — keeps the link strip hidden so it doesn't pop in empty.
  const [adminStats, setAdminStats] = useState<{ activated24h: number; activated7d: number } | null>(null);
  // Admin-only "Grant permissions" popup. Holds the target player id when open.
  const [grantTargetId, setGrantTargetId] = useState<string | null>(null);
  // Player ids whose clubs/ligas list is expanded past the 3-row cap.
  const [expandedClubs, setExpandedClubs] = useState<Set<string>>(new Set());
  const toggleExpandClubs = (id: string) =>
    setExpandedClubs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const { viewRole } = useViewRole();
  const isAdmin = session?.user?.role === "admin" && hasRole(viewRole, "admin");

  // Server-side search + pagination. The server caps to `limit` rows and
  // signals overflow via response headers (X-Total, X-Has-More). The
  // client passes the search query so name-filtering happens in the DB,
  // not over the wire.
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [currentLimit, setCurrentLimit] = useState(100);

  const fetchPlayers = useCallback(async (limit: number, q: string, country: string, activatedSince: "24h" | "7d" | null) => {
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (q.trim()) params.set("q", q.trim());
      if (country) params.set("country", country);
      if (activatedSince) params.set("activatedSince", activatedSince);
      const r = await fetch(`/api/players?${params.toString()}`);
      if (!r.ok) {
        setPlayers([]);
        setHasMore(false);
        return;
      }
      const text = await r.text();
      // Defensive parse: an empty body shouldn't crash the page.
      const data = text ? JSON.parse(text) : [];
      setPlayers(Array.isArray(data) ? data : []);
      const totalHeader = r.headers.get("X-Total");
      const moreHeader = r.headers.get("X-Has-More");
      setTotalCount(totalHeader ? parseInt(totalHeader, 10) : null);
      setHasMore(moreHeader === "1");
    } catch {
      setPlayers([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Apply the signed-in user's country as the initial filter — once.
  // After that the user's manual choice (including "All") wins.
  useEffect(() => {
    if (countryDefaultApplied) return;
    const mine = (session?.user as { country?: string | null } | undefined)?.country;
    if (mine) setCountryFilter(mine);
    setCountryDefaultApplied(true);
  }, [session, countryDefaultApplied]);

  // Initial load + debounced refetch when the search query / country
  // / "new users" window changes. Search alone gets a 250ms debounce
  // because it fires on every keystroke; the other filters refire
  // immediately because they only change on direct user action.
  useEffect(() => {
    const t = setTimeout(() => {
      void fetchPlayers(currentLimit, searchQuery, countryFilter, activatedSinceFilter);
    }, searchQuery ? 250 : 0);
    return () => clearTimeout(t);
  }, [fetchPlayers, currentLimit, searchQuery, countryFilter, activatedSinceFilter]);

  // App-admin "new users" stats. Single fetch on mount; refreshes
  // whenever the player list is refetched (so the counts stay
  // close-enough to live without a separate poll).
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/players/stats");
        if (!r.ok || cancelled) return;
        const data = await r.json();
        if (!cancelled) setAdminStats({ activated24h: data.activated24h ?? 0, activated7d: data.activated7d ?? 0 });
      } catch { /* leave adminStats null — strip stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, players.length]);


  const voidPlayer = async (id: string, playerName: string) => {
    const ok = await confirmDialog({
      title: `Remove ${playerName}?`,
      message: "If they have match history they'll be voided (hidden, data preserved).",
      confirmText: "Remove",
      danger: true,
    });
    if (!ok) return;
    await fetch(`/api/players/${id}/void`, { method: "POST" });
    fetchPlayers(currentLimit, searchQuery, countryFilter, activatedSinceFilter);
  };

  const startEdit = (p: Player) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditGender(p.gender || null);
    setEditPhone(p.phone || "");
    setEditCountry((p as Player & { country?: string | null }).country || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditCountry("");
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    await fetch(`/api/players/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName.trim(),
        gender: editGender,
        phone: editPhone.trim() || null,
        country: editCountry || null,
      }),
    });
    cancelEdit();
    fetchPlayers(currentLimit, searchQuery, countryFilter, activatedSinceFilter);
  };

  const invitePlayer = async (player: Player) => {
    setInvitingId(player.id);
    try {
      const res = await fetch(`/api/players/${player.id}/invite`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        await alertDialog(data.error || "Failed to generate invite");
        return;
      }

      const claimUrl = personalClaimUrl(window.location.origin, data.token, player.name);
      const firstName = player.name.split(" ")[0];
      const inviterName = session?.user?.name || "A friend";
      const shareText = withInstallTip(
        `Hi ${firstName},\n\n${inviterName} invited you to FriendlyBall — the friendly pickleball app. You've already been added as a player, so we just need you to set up your account:\n\n${claimUrl}`,
        { forClaim: true },
      );

      // Open our share chooser instead of navigator.share. The native
      // sheet doesn't include WhatsApp on macOS, which makes it useless
      // for the primary intended channel. The chooser offers WhatsApp
      // (deep-linked to the player's phone when known), Copy, and Email.
      setInviteShare({
        playerId: player.id,
        message: shareText,
        phone: player.phone ?? null,
        title: `Invite ${player.name}`,
        emailSubject: `Join FriendlyBall — ${player.name}`,
      });
    } finally {
      setInvitingId(null);
    }
  };

  // Record an invite as actually sent. The colour-coded UnclaimedIcon
  // depends on `lastInvitedAt`, so we bump the player's row optimistically
  // before the network call resolves — the colour shifts instantly. On
  // error the next refresh corrects the count.
  const markPlayerInviteSent = async (playerId: string) => {
    const nowIso = new Date().toISOString();
    setPlayers((prev) => prev.map((p) => p.id === playerId
      ? { ...p, invitesSent: (p.invitesSent || 0) + 1, lastInvitedAt: nowIso }
      : p));
    try {
      await fetch(`/api/players/${playerId}/invite/sent`, { method: "POST" });
    } catch {
      // Optimistic update stays; next fetch reconciles.
    }
  };

  const resetPlayer = async (player: Player) => {
    setResettingId(player.id);
    try {
      const res = await fetch(`/api/players/${player.id}/reset`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        await alertDialog(data.error || "Failed to generate reset link");
        return;
      }

      const resetUrl = `${window.location.origin}/reset/${data.token}`;
      const shareText = `Reset your FriendlyBall password:\n\n${resetUrl}`;

      if (navigator.share) {
        try {
          await navigator.share({
            title: "FriendlyBall Password Reset",
            text: shareText,
          });
          return;
        } catch {
          // Fall through to clipboard
        }
      }

      const ok = await copyText(shareText);
      if (ok) {
        setCopiedId(player.id);
        setTimeout(() => setCopiedId(null), 2000);
      } else {
        await alertDialog(`Couldn't copy automatically. Here's the reset link:\n\n${shareText}`);
      }
    } finally {
      setResettingId(null);
    }
  };

  // Generic grant flow. Admin clicks the Grant chip on a player row →
  // the popup at the bottom of the page (grantTargetId) opens with two
  // toggles, one for each permission. Each toggle hits the API directly
  // and updates state.
  const setPermission = async (
    player: Player,
    field: "canCreateLeagues" | "canCreateClubs",
    next: boolean,
  ) => {
    const res = await fetch(`/api/players/${player.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: next }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      await alertDialog(data.error || "Failed to update");
      return;
    }
    fetchPlayers(currentLimit, searchQuery, countryFilter, activatedSinceFilter);
  };

  const resetRating = async (player: Player) => {
    const ok = await confirmDialog({
      title: `Reset ${player.name}'s rating?`,
      message: "Sets rating to 1000 and clears W/L.",
      confirmText: "Reset",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/players/${player.id}/reset-rating`, { method: "POST" });
    if (!res.ok) {
      await alertDialog("Failed to reset rating");
      return;
    }
    fetchPlayers(currentLimit, searchQuery, countryFilter, activatedSinceFilter);
  };

  const isUnclaimed = (p: Player) => !p.hasAccount;

  // All distinct clubs that appear in the loaded player list (for the filter dropdown).
  const allClubs = Array.from(
    new Map(
      players.flatMap((p) => p.clubs || []).map((c) => [c.id, c]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  const filteredPlayers = players
    .filter((p) => nameMatchesSearch(p.name, searchQuery))
    .filter((p) => !genderFilter || p.gender === genderFilter)
    .filter((p) => !clubFilter || (p.clubs || []).some((c) => c.id === clubFilter))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Players {!loading && `(${searchQuery ? `${filteredPlayers.length} of ${players.length}` : players.length})`}</h2>
        {isAdmin && (
          <Link
            href="/players/new"
            className="text-action border border-action/30 px-4 py-2 rounded-lg font-medium text-sm hover:bg-action/5 active:bg-action/10 transition-colors"
          >
            + Player
          </Link>
        )}
      </div>

      {/* App-admin "new users" strip — two clickable counts that filter
          the list to recently-activated accounts (self-registered OR
          claimed via invite). Click again to clear. Hidden when stats
          haven't loaded yet so it doesn't pop in empty. */}
      {isAdmin && adminStats && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted">New users:</span>
          <button
            type="button"
            onClick={() => setActivatedSinceFilter((prev) => prev === "24h" ? null : "24h")}
            className={`px-2 py-1 rounded-lg font-medium transition-colors ${
              activatedSinceFilter === "24h"
                ? "bg-action text-white"
                : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
            }`}
          >
            {adminStats.activated24h} · 24h
          </button>
          <button
            type="button"
            onClick={() => setActivatedSinceFilter((prev) => prev === "7d" ? null : "7d")}
            className={`px-2 py-1 rounded-lg font-medium transition-colors ${
              activatedSinceFilter === "7d"
                ? "bg-action text-white"
                : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
            }`}
          >
            {adminStats.activated7d} · 7d
          </button>
          {activatedSinceFilter && (
            <button
              type="button"
              onClick={() => setActivatedSinceFilter(null)}
              className="text-muted hover:text-foreground underline ml-1"
            >Clear</button>
          )}
        </div>
      )}

      <ClearInput value={searchQuery} onChange={setSearchQuery} placeholder="Search players..." className="text-base" />
      {/* Country + Clubs filters on one row when there's space. Country
          defaults to the signed-in user's country (server-side filter,
          so the pool is sized down before it hits the wire). */}
      <div className="grid grid-cols-2 gap-2">
        <select
          value={countryFilter}
          onChange={(e) => { setCountryFilter(e.target.value); setCurrentLimit(100); }}
          className="border border-border rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">All countries</option>
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={clubFilter}
          onChange={(e) => setClubFilter(e.target.value)}
          className="border border-border rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">All clubs</option>
          {allClubs.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      {/* Gender filter as toggle pair + filtered count on the right.
          No "All" button — clicking the currently-active pill clears
          the filter to show everyone. */}
      <div className="flex items-center gap-2">
        {([
          { value: "M", label: "♂ Male" },
          { value: "F", label: "♀ Female" },
        ] as const).map((g) => (
          <button
            key={g.value}
            onClick={() => setGenderFilter((cur) => (cur === g.value ? null : g.value))}
            className={`px-3 py-2 rounded-lg font-medium text-sm transition-all ${
              genderFilter === g.value ? "bg-black text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
            }`}
          >
            {g.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted tabular-nums">
          {filteredPlayers.length}
          {totalCount !== null && totalCount > filteredPlayers.length && (
            <> of {totalCount}</>
          )}{" "}
          {filteredPlayers.length === 1 ? "player" : "players"}
        </span>
      </div>

      {loading ? (
        <LoadingState label="Loading players…" />
      ) : players.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-3">👥</div>
          <p className="text-muted">No players yet. Add some!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredPlayers.map((p) => (
            <div
              key={p.id}
              className={`${frameClass} p-3`}
            >
              {editingId === p.id ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    autoFocus
                  />
                  <div>
                    <label className="block text-sm font-medium text-muted mb-1">Gender (optional)</label>
                    <div className="flex gap-2">
                      {[
                        { value: null, label: "Skip" },
                        { value: "M", label: "♂ Male" },
                        { value: "F", label: "♀ Female" },
                      ].map((g) => (
                        <button
                          key={g.label}
                          type="button"
                          onClick={() => setEditGender(g.value)}
                          className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${
                            editGender === g.value
                              ? "bg-action text-white"
                              : "bg-gray-100 text-foreground hover:bg-gray-200"
                          }`}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-muted mb-1">WhatsApp (optional)</label>
                    <input
                      type="tel"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      placeholder="+CC 123 456 789"
                      className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-muted mb-1">Country</label>
                    <select
                      value={editCountry}
                      onChange={(e) => setEditCountry(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/50"
                    >
                      <option value="">— unset —</option>
                      {COUNTRIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={saveEdit}
                      className="flex-1 bg-action-dark text-white py-2 rounded-lg font-medium text-sm"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="flex-1 bg-gray-100 text-foreground py-2 rounded-lg font-medium text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  {(() => {
                    // Combined clubs + ligas as a single right-justified
                    // stack. First item lives on row 2 (next to the stats);
                    // the rest fall to row 3+. Capped at 3 with an expand
                    // toggle when there's more.
                    type Badge = { key: string; node: ReactNode };
                    const clubBadges: Badge[] = (p.clubs || []).map((c) => ({
                      key: `c-${c.id}`,
                      node: (
                        <span
                          className="text-[10px] bg-gray-100 text-foreground px-2 py-0.5 rounded-full font-medium truncate max-w-[60vw]"
                          title={`${c.name} (${c.role})`}
                        >
                          {c.role === "owner" ? "👑 " : c.role === "admin" ? "⭐ " : ""}{c.name}
                        </span>
                      ),
                    }));
                    const ligaBadges: Badge[] = (p.leagueTeams || []).map((lt) => ({
                      key: `l-${lt.teamId}`,
                      node: (
                        <span
                          className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium truncate max-w-[60vw]"
                          title={`${lt.leagueName}${lt.season ? ` (${lt.season})` : ""} — ${lt.teamName}`}
                        >
                          🏆 {shortLeagueName(lt.leagueName)} · {lt.teamName}
                        </span>
                      ),
                    }));
                    const allBadges = [...clubBadges, ...ligaBadges];
                    const CAP = 3;
                    const expanded = expandedClubs.has(p.id);
                    const showAll = expanded || allBadges.length <= CAP;
                    const visible = showAll ? allBadges : allBadges.slice(0, CAP);
                    const remaining = allBadges.length - visible.length;

                    // Stats line: club rank (n/a in global list), app
                    // rating (admin-only for now), DUPR. Each piece is
                    // optional; if all are absent the line is empty but
                    // we still render the row so the first club stays
                    // right-aligned on row 2.
                    const statsParts: ReactNode[] = [];
                    if (isAdmin) {
                      statsParts.push(
                        <span key="app" className="tabular-nums">
                          <span className="text-muted/70">App </span>{Math.round(p.rating)}
                        </span>
                      );
                    }
                    if (p.duprRating != null) {
                      statsParts.push(
                        <span key="dupr" className="tabular-nums">
                          <span className="text-muted/70">DUPR </span>{p.duprRating.toFixed(2)}
                        </span>
                      );
                    }
                    const statsLine = statsParts.length > 0 ? (
                      <div className="flex items-center gap-2 text-[11px] text-muted">
                        {statsParts.map((part, i) => (
                          <span key={i} className="flex items-center gap-2">
                            {i > 0 && <span className="text-muted/40">·</span>}
                            {part}
                          </span>
                        ))}
                      </div>
                    ) : null;

                    return (
                      <div className="flex items-start gap-3">
                        <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="md" />
                        <div className="flex-1 min-w-0">
                          {/* Row 1: gender · name · role pills · Unclaimed icon · WhatsApp */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {p.gender && (
                              <span className={`text-sm shrink-0 ${p.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
                                {p.gender === "M" ? "♂" : "♀"}
                              </span>
                            )}
                            <span className="font-semibold text-lg">{p.name}</span>
                            {p.role === "admin" && (
                              <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium">
                                Admin
                              </span>
                            )}
                            {p.canCreateLeagues && p.role !== "admin" && (
                              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium" title="Can create leagues">
                                🏆 League
                              </span>
                            )}
                            {p.canCreateClubs && p.role !== "admin" && (
                              <span className="text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full font-medium" title="Can create clubs">
                                🏟️ Club
                              </span>
                            )}
                            {isUnclaimed(p) && (
                              <UnclaimedIcon
                                onClick={isAdmin ? () => invitePlayer(p) : undefined}
                                disabled={invitingId === p.id}
                                invitesSent={p.invitesSent}
                                lastInvitedAt={p.lastInvitedAt}
                              />
                            )}
                            {p.phone && (
                              <a
                                href={`https://wa.me/${p.phone.replace(/[^0-9+]/g, "").replace(/^\+/, "")}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 inline-flex"
                                onClick={(e) => e.stopPropagation()}
                                title={`WhatsApp ${p.name}`}
                                aria-label={`WhatsApp ${p.name}`}
                              >
                                <WhatsAppIcon />
                              </a>
                            )}
                          </div>

                          {/* Rows 2+: stats left, clubs/ligas right (stacked) */}
                          {(statsLine || allBadges.length > 0 || (p.email && (isAdmin || session?.user?.id === p.id))) && (
                            <div className="mt-1 space-y-0.5">
                              {(statsLine || visible[0]) && (
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    {statsLine}
                                  </div>
                                  {visible[0]?.node}
                                </div>
                              )}
                              {visible.slice(1).map((b) => (
                                <div key={b.key} className="flex justify-end">
                                  {b.node}
                                </div>
                              ))}
                              {(remaining > 0 || (expanded && allBadges.length > CAP)) && (
                                <div className="flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => toggleExpandClubs(p.id)}
                                    className="text-[10px] text-action px-2 py-0.5 rounded-full hover:bg-action/5 active:bg-action/10 transition-colors"
                                  >
                                    {expanded ? "Show less" : `+${remaining} more`}
                                  </button>
                                </div>
                              )}
                              {p.email && (isAdmin || session?.user?.id === p.id) && (
                                <div className="text-[11px] text-muted truncate">{p.email}</div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  {isAdmin && (
                    <div className="flex items-center gap-1 mt-2 ml-12 flex-wrap">
                      {!isUnclaimed(p) && (
                        <button
                          onClick={() => resetPlayer(p)}
                          disabled={resettingId === p.id}
                          className="text-amber-600 text-xs px-2 py-1 rounded hover:bg-amber-50 transition-colors disabled:opacity-50"
                        >
                          {copiedId === p.id ? "Copied!" : resettingId === p.id ? "..." : "Reset PW"}
                        </button>
                      )}
                      {(p.wins > 0 || p.losses > 0 || p.rating !== 1000) && (
                        <button
                          onClick={() => resetRating(p)}
                          className="text-blue-600 text-xs px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                          Reset ELO
                        </button>
                      )}
                      {p.role !== "admin" && (
                        <button
                          onClick={() => setGrantTargetId(p.id)}
                          className={`text-xs px-2 py-1 rounded transition-colors ${
                            p.canCreateLeagues || p.canCreateClubs
                              ? "text-emerald-700 hover:bg-emerald-50"
                              : "text-muted hover:bg-gray-100"
                          }`}
                          title="Grant or revoke creation permissions"
                        >
                          🔑 Grant
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(p)}
                        className="text-muted text-xs px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => voidPlayer(p.id, p.name)}
                        className="text-danger text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors"
                      >
                        {(p._count?.matchPlayers ?? 0) > 0 ? "Void" : "Delete"}
                      </button>
                    </div>
                  )}
                  {!isAdmin && session?.user?.id === p.id && (
                    <div className="mt-2 ml-12">
                      <button
                        onClick={() => startEdit(p)}
                        className="text-muted text-xs px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={() => setCurrentLimit((n) => n + 100)}
              className="w-full mt-2 py-2.5 rounded-lg border border-border text-sm font-medium text-action hover:bg-action/5 active:bg-action/10 transition-colors"
            >
              Load more
              {totalCount !== null && (
                <span className="text-xs text-muted font-normal ml-1.5">
                  ({Math.min(currentLimit + 100, totalCount) - filteredPlayers.length} more)
                </span>
              )}
            </button>
          )}
        </div>
      )}

      {/* Grant-permissions popup (app-admin only). Shows two toggles —
          one per permission — so admins can grant or revoke League and
          Club creation independently. Normal users have neither by
          default. */}
      {grantTargetId && (() => {
        const target = players.find((pp) => pp.id === grantTargetId);
        if (!target) return null;
        return (
          <div
            className="fixed inset-0 z-[90] bg-black/50 flex items-end justify-center"
            onClick={() => setGrantTargetId(null)}
          >
            <div
              className="bg-white rounded-t-2xl w-full max-w-[600px] shadow-2xl mx-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mt-3 mb-2" />
              <div className="px-4 pb-3 border-b border-border">
                <h2 className="text-base font-bold">Grant permissions</h2>
                <p className="text-xs text-muted">For {target.name}.</p>
              </div>
              <div className="p-4 space-y-2">
                <button
                  onClick={() => setPermission(target, "canCreateLeagues", !target.canCreateLeagues)}
                  className={`w-full flex items-center justify-between py-3 px-3 rounded-xl border ${
                    target.canCreateLeagues ? "bg-emerald-50 border-emerald-300" : "bg-white border-border"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span>🏆</span>
                    <span className="text-sm font-medium">Create leagues</span>
                  </span>
                  <span className={`text-xs font-semibold ${target.canCreateLeagues ? "text-emerald-700" : "text-muted"}`}>
                    {target.canCreateLeagues ? "Granted · tap to revoke" : "Tap to grant"}
                  </span>
                </button>
                <button
                  onClick={() => setPermission(target, "canCreateClubs", !target.canCreateClubs)}
                  className={`w-full flex items-center justify-between py-3 px-3 rounded-xl border ${
                    target.canCreateClubs ? "bg-sky-50 border-sky-300" : "bg-white border-border"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span>🏟️</span>
                    <span className="text-sm font-medium">Create clubs</span>
                  </span>
                  <span className={`text-xs font-semibold ${target.canCreateClubs ? "text-sky-700" : "text-muted"}`}>
                    {target.canCreateClubs ? "Granted · tap to revoke" : "Tap to grant"}
                  </span>
                </button>
                <button
                  onClick={() => setGrantTargetId(null)}
                  className="w-full py-2.5 mt-2 rounded-xl bg-gray-100 text-sm font-medium"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <ShareInviteModal
        open={!!inviteShare}
        message={inviteShare?.message ?? ""}
        phone={inviteShare?.phone ?? null}
        title={inviteShare?.title}
        emailSubject={inviteShare?.emailSubject}
        onMarkSent={inviteShare ? () => markPlayerInviteSent(inviteShare.playerId) : undefined}
        onClose={() => setInviteShare(null)}
      />
    </div>
  );
}
