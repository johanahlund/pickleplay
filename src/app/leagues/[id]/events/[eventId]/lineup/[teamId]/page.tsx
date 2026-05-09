"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { PlayerAvatar } from "@/components/PlayerAvatar";

interface PlayerLite { id: string; name: string; photoUrl?: string | null; gender?: string | null; duprRating?: number | null }
interface Category {
  id: string; name: string; format: string; gender: string; ageGroup: string;
  skillMin: number | null; skillMax: number | null; sortOrder: number; maxPerEvent: number | null;
  status?: string;
}
interface SlotInput { categoryId: string; slotNumber: number; player1Id: string; player2Id: string | null }
interface LineupView {
  id: string; teamId: string; status: "draft" | "submitted" | "revealed";
  submittedAt: string | null;
  submittedBy: { id: string; name: string } | null;
  unlockRequestedBy: { id: string; name: string } | null;
  slotCount: number;
  slots: { id: string; categoryId: string; slotNumber: number; player1: PlayerLite; player2: PlayerLite | null }[] | null;
}

export default function LineupBuilderPage() {
  const { id, eventId, teamId } = useParams() as { id: string; eventId: string; teamId: string };
  const router = useRouter();
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string })?.id;
  const userRole = (session?.user as { role?: string })?.role;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [team, setTeam] = useState<{ id: string; name: string; captainId: string | null; viceCaptainId: string | null } | null>(null);
  const [opponentTeam, setOpponentTeam] = useState<{ id: string; name: string } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [roster, setRoster] = useState<PlayerLite[]>([]);
  const [config, setConfig] = useState<{ allowCrossCategoryPlay?: boolean; maxMatchesPerEvent?: number }>({});
  const [leagueOrg, setLeagueOrg] = useState<{ createdById: string | null; deputyId: string | null }>({ createdById: null, deputyId: null });
  const [myLineup, setMyLineup] = useState<LineupView | null>(null);
  const [opponentLineup, setOpponentLineup] = useState<LineupView | null>(null);
  const [slots, setSlots] = useState<SlotInput[]>([]);
  const [dirty, setDirty] = useState(false);
  const [pickerFor, setPickerFor] = useState<{ categoryId: string; slotNumber: number; which: 1 | 2 } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isAppAdmin = userRole === "admin";
  const isOrganizer = isAppAdmin || (!!userId && (leagueOrg.createdById === userId || leagueOrg.deputyId === userId));
  const isTeamLeader = !!userId && team && (team.captainId === userId || team.viceCaptainId === userId);
  const canEdit = isOrganizer || isTeamLeader;

  // Hide bottom nav while editing
  useEffect(() => {
    const nav = document.querySelector("nav.fixed.bottom-0");
    nav?.classList.add("hidden");
    return () => { nav?.classList.remove("hidden"); };
  }, []);

  const loadAll = useCallback(async () => {
    const [leagueR, lineupsR] = await Promise.all([
      fetch(`/api/leagues/${id}`),
      fetch(`/api/leagues/${id}/events/${eventId}/lineups`),
    ]);
    const league = await leagueR.json();
    const lineupsBundle = await lineupsR.json();
    setCategories((league.categories || []).filter((c: Category) => c.id));
    setConfig(league.config || {});
    setLeagueOrg({ createdById: league.createdBy?.id || null, deputyId: league.deputy?.id || null });
    const t = (league.teams || []).find((x: { id: string }) => x.id === teamId);
    setTeam(t ? { id: t.id, name: t.name, captainId: t.captain?.id || null, viceCaptainId: t.viceCaptain?.id || null } : null);
    setRoster((t?.players || []).map((tp: { player: PlayerLite }) => tp.player));
    const opp = (lineupsBundle.teams || []).find((x: { id: string }) => x.id !== teamId);
    setOpponentTeam(opp || null);
    const my: LineupView | undefined = (lineupsBundle.lineups || []).find((l: LineupView) => l.teamId === teamId);
    const other: LineupView | undefined = (lineupsBundle.lineups || []).find((l: LineupView) => l.teamId !== teamId);
    setMyLineup(my || null);
    setOpponentLineup(other || null);
    if (my?.slots) {
      setSlots(my.slots.map((s) => ({ categoryId: s.categoryId, slotNumber: s.slotNumber, player1Id: s.player1.id, player2Id: s.player2?.id || null })));
    } else {
      setSlots([]);
    }
    setDirty(false);
    setLoading(false);
  }, [id, eventId, teamId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const isDoubles = (cat: Category) => cat.format === "doubles";

  // Eligibility check for the picker — gender/age/skill, soft for organizers
  const isEligible = (cat: Category, p: PlayerLite): boolean => {
    if (isOrganizer) return true; // organizer can override
    if (cat.gender === "male" && p.gender !== "M") return false;
    if (cat.gender === "female" && p.gender !== "F") return false;
    if (cat.skillMin != null && p.duprRating != null && p.duprRating < cat.skillMin) return false;
    if (cat.skillMax != null && p.duprRating != null && p.duprRating > cat.skillMax) return false;
    return true;
  };

  // Players already used in this category (excluded from picker for the same category)
  const usedInCategory = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const s of slots) {
      const set = map.get(s.categoryId) || new Set<string>();
      set.add(s.player1Id);
      if (s.player2Id) set.add(s.player2Id);
      map.set(s.categoryId, set);
    }
    return map;
  }, [slots]);

  // Players used anywhere (used for cross-category warning, or hard-block if disallowed)
  const usedAnywhere = useMemo(() => {
    const set = new Set<string>();
    for (const s of slots) { set.add(s.player1Id); if (s.player2Id) set.add(s.player2Id); }
    return set;
  }, [slots]);

  const setSlotPlayer = (categoryId: string, slotNumber: number, which: 1 | 2, playerId: string | null) => {
    setSlots((prev) => {
      const existing = prev.find((s) => s.categoryId === categoryId && s.slotNumber === slotNumber);
      if (!existing) {
        if (!playerId) return prev;
        const next: SlotInput = { categoryId, slotNumber, player1Id: which === 1 ? playerId : "", player2Id: which === 2 ? playerId : null };
        if (!next.player1Id) return prev;
        return [...prev, next];
      }
      const updated: SlotInput = { ...existing };
      if (which === 1) updated.player1Id = playerId || "";
      else updated.player2Id = playerId;
      // Remove the slot if no players remain
      if (!updated.player1Id && !updated.player2Id) {
        return prev.filter((s) => !(s.categoryId === categoryId && s.slotNumber === slotNumber));
      }
      // Keep player1 always populated; if player1 cleared but player2 set, promote
      if (!updated.player1Id && updated.player2Id) { updated.player1Id = updated.player2Id; updated.player2Id = null; }
      return prev.map((s) => (s.categoryId === categoryId && s.slotNumber === slotNumber) ? updated : s);
    });
    setDirty(true);
    setPickerFor(null);
  };

  const slotsByCategory = (catId: string) =>
    slots.filter((s) => s.categoryId === catId).sort((a, b) => a.slotNumber - b.slotNumber);

  const playerById = useMemo(() => new Map(roster.map((p) => [p.id, p])), [roster]);

  const saveDraft = async () => {
    setSaving(true);
    setErrorMsg(null);
    const r = await fetch(`/api/leagues/${id}/events/${eventId}/lineups/${teamId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slots }),
    });
    setSaving(false);
    if (!r.ok) { const d = await r.json().catch(() => ({})); setErrorMsg(d.error || "Failed to save"); return false; }
    await loadAll();
    return true;
  };

  const submit = async () => {
    if (dirty) { const ok = await saveDraft(); if (!ok) return; }
    setSaving(true);
    setErrorMsg(null);
    const r = await fetch(`/api/leagues/${id}/events/${eventId}/lineups/${teamId}/submit`, { method: "POST" });
    setSaving(false);
    if (!r.ok) { const d = await r.json().catch(() => ({})); setErrorMsg(d.error || "Failed to submit"); return; }
    await loadAll();
  };

  const requestUnlock = async () => {
    setSaving(true);
    const r = await fetch(`/api/leagues/${id}/events/${eventId}/lineups/${teamId}/unlock-request`, { method: "POST" });
    setSaving(false);
    if (!r.ok) { const d = await r.json().catch(() => ({})); setErrorMsg(d.error || "Failed to unlock"); return; }
    await loadAll();
  };

  const cancelUnlock = async () => {
    setSaving(true);
    await fetch(`/api/leagues/${id}/events/${eventId}/lineups/${teamId}/unlock-request`, { method: "DELETE" });
    setSaving(false);
    await loadAll();
  };

  const back = () => router.push(`/leagues/${id}?tab=rounds`);

  if (loading) return <div className="space-y-2"><div className="text-sm text-muted py-8 text-center">Loading lineup…</div></div>;
  if (!team || !canEdit) {
    return (
      <div className="space-y-2">
        <button onClick={back} className="text-sm text-action font-medium">← Back</button>
        <div className="bg-card rounded-xl border border-border p-4 text-sm">You don&apos;t have permission to edit this team&apos;s lineup.</div>
      </div>
    );
  }

  const status = myLineup?.status || "draft";
  const isLocked = status !== "draft";
  const oppStatus = opponentLineup?.status || "draft";
  const unlockPending = !!myLineup?.unlockRequestedBy;

  return (
    <div className="space-y-2">
      <div className="sticky top-0 z-30 bg-background -mx-4 px-4 py-2 shadow-sm">
        <button onClick={back} className="text-sm text-action font-medium">← Back to Rounds</button>
      </div>

      <div className="bg-card rounded-xl border border-border p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Lineup — {team.name}</h2>
            <div className="text-xs text-muted">vs {opponentTeam?.name || "—"}</div>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            status === "draft" ? "bg-blue-100 text-blue-700"
              : status === "submitted" ? "bg-amber-100 text-amber-700"
              : "bg-green-100 text-green-700"
          }`}>{status}</span>
        </div>
        <div className="text-[11px] text-muted">
          Opponent status: <span className="font-medium text-foreground">{oppStatus}</span>
          {oppStatus !== "draft" && opponentLineup?.slotCount !== undefined && (
            <span className="ml-1">({opponentLineup.slotCount} slots)</span>
          )}
        </div>
        {errorMsg && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">{errorMsg}</div>
        )}
        {unlockPending && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            Unlock requested by {myLineup?.unlockRequestedBy?.name}. Waiting for the opponent (or organizer) to confirm.
            {(isTeamLeader || isOrganizer) && (
              <button onClick={cancelUnlock} className="ml-2 text-action font-medium">Cancel request</button>
            )}
          </div>
        )}
      </div>

      {categories.filter((c) => c.status !== "draft" && c.maxPerEvent !== 0).map((cat) => {
        const catSlots = slotsByCategory(cat.id);
        const maxSlots = cat.maxPerEvent ?? 99;
        const canAddSlot = !isLocked && catSlots.length < maxSlots;
        const nextSlotNum = (catSlots[catSlots.length - 1]?.slotNumber ?? 0) + 1;
        const usedInThisCat = usedInCategory.get(cat.id) || new Set<string>();
        const renderPickerOption = (p: PlayerLite, slot: SlotInput | null, which: 1 | 2) => {
          const inThisSlotPair = slot && (slot.player1Id === p.id || slot.player2Id === p.id);
          const usedInOtherSlotInCat = usedInThisCat.has(p.id) && !inThisSlotPair;
          const usedElsewhere = usedAnywhere.has(p.id) && !inThisSlotPair && !usedInThisCat.has(p.id);
          const eligible = isEligible(cat, p);
          const blockedSameCat = usedInOtherSlotInCat;
          const blockedCross = !config.allowCrossCategoryPlay && usedElsewhere;
          const disabled = blockedSameCat || blockedCross || (!eligible && !isOrganizer);
          return (
            <button
              key={`${p.id}-${which}`}
              type="button"
              disabled={disabled}
              onClick={() => setSlotPlayer(cat.id, slot ? slot.slotNumber : nextSlotNum, which, p.id)}
              className={`w-full text-left px-3 py-2 rounded-lg border ${disabled ? "opacity-40" : "hover:bg-gray-50"} flex items-center gap-2`}
            >
              <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="xs" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.name}</div>
                {(blockedSameCat || blockedCross || !eligible) && (
                  <div className="text-[10px] text-muted truncate">
                    {blockedSameCat ? "Already in this category" : blockedCross ? "Already in another category" : !eligible ? (isOrganizer ? "Out-of-category (override OK)" : "Not eligible for this category") : ""}
                  </div>
                )}
              </div>
              {p.gender && <span className={`text-xs ${p.gender === "F" ? "text-pink-500" : "text-blue-500"}`}>{p.gender === "F" ? "♀" : "♂"}</span>}
              {usedElsewhere && config.allowCrossCategoryPlay && <span className="text-[10px] text-amber-600">⚠ also used</span>}
            </button>
          );
        };

        return (
          <div key={cat.id} className="bg-card rounded-xl border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{cat.name}</div>
              <div className="text-[11px] text-muted">{catSlots.length}{cat.maxPerEvent != null ? ` / ${cat.maxPerEvent}` : ""}</div>
            </div>
            {Array.from({ length: Math.max(catSlots.length, canAddSlot ? catSlots.length + 1 : catSlots.length) }, (_, i) => {
              const slotNumber = i + 1;
              const slot = catSlots.find((s) => s.slotNumber === slotNumber) || null;
              const p1 = slot ? playerById.get(slot.player1Id) : undefined;
              const p2 = slot && slot.player2Id ? playerById.get(slot.player2Id) : undefined;
              return (
                <div key={slotNumber} className="border border-border rounded-lg p-2 space-y-1">
                  <div className="text-[10px] text-muted uppercase tracking-wide">Slot {slotNumber}</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => setPickerFor({ categoryId: cat.id, slotNumber, which: 1 })}
                      className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg border ${isLocked ? "opacity-60" : "hover:bg-gray-50"}`}
                    >
                      {p1 ? <><PlayerAvatar name={p1.name} photoUrl={p1.photoUrl} size="xs" /><span className="text-sm font-medium truncate">{p1.name}</span></> : <span className="text-sm text-muted">+ Player</span>}
                    </button>
                    {isDoubles(cat) && (
                      <button
                        type="button"
                        disabled={isLocked || !slot}
                        onClick={() => setPickerFor({ categoryId: cat.id, slotNumber, which: 2 })}
                        className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg border ${isLocked || !slot ? "opacity-60" : "hover:bg-gray-50"}`}
                      >
                        {p2 ? <><PlayerAvatar name={p2.name} photoUrl={p2.photoUrl} size="xs" /><span className="text-sm font-medium truncate">{p2.name}</span></> : <span className="text-sm text-muted">+ Partner</span>}
                      </button>
                    )}
                    {!isLocked && slot && (
                      <button
                        type="button"
                        onClick={() => { setSlots((prev) => prev.filter((s) => !(s.categoryId === cat.id && s.slotNumber === slotNumber))); setDirty(true); }}
                        className="text-xs text-danger px-2 hover:underline"
                      >✕</button>
                    )}
                  </div>
                </div>
              );
            })}
            {/* Player picker overlay for this category if active */}
            {pickerFor && pickerFor.categoryId === cat.id && (() => {
              const slot = catSlots.find((s) => s.slotNumber === pickerFor.slotNumber) || null;
              return (
                <div className="border border-border rounded-lg p-2 space-y-1 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium">Pick player {pickerFor.which === 2 ? "(partner)" : ""}</div>
                    <button onClick={() => setPickerFor(null)} className="text-xs text-muted">Cancel</button>
                  </div>
                  <div className="space-y-1 max-h-72 overflow-y-auto">
                    {[...roster].sort((a, b) => a.name.localeCompare(b.name)).map((p) => renderPickerOption(p, slot, pickerFor.which))}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })}

      {/* Footer actions */}
      <div className="bg-card rounded-xl border border-border p-3 sticky bottom-2 flex gap-2">
        {!isLocked ? (
          <>
            <button onClick={saveDraft} disabled={saving || !dirty} className="flex-1 bg-gray-100 text-foreground py-2.5 rounded-xl font-medium text-sm disabled:opacity-50">
              {saving ? "Saving…" : "Save Draft"}
            </button>
            <button onClick={submit} disabled={saving || slots.length === 0} className="flex-1 bg-action text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50">
              {saving ? "…" : "Submit Lineup"}
            </button>
          </>
        ) : (
          !unlockPending && (
            <button onClick={requestUnlock} disabled={saving} className="flex-1 bg-gray-100 text-foreground py-2.5 rounded-xl font-medium text-sm disabled:opacity-50">
              {saving ? "…" : (isOrganizer || oppStatus === "draft") ? "Unlock" : "Request Unlock"}
            </button>
          )
        )}
      </div>
    </div>
  );
}
