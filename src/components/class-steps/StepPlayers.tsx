"use client";

import { useEffect, useState, useCallback } from "react";
import { PlayerSelector } from "../PlayerSelector";
import { PlayerAvatar } from "../PlayerAvatar";

interface Player {
  id: string;
  name: string;
  emoji: string;
  photoUrl?: string | null;
  gender?: string | null;
  rating: number;
}

interface EventPair {
  id: string;
  player1: Player;
  player2: Player;
  player1Id: string;
  player2Id: string;
  classId?: string | null;
}

interface PairRequest {
  id: string;
  requesterId: string;
  requestedId: string;
  status: string;
  requester: Player;
  requested: Player;
}

interface StepPlayersProps {
  eventId: string;
  cls: {
    id: string;
    format: string;
    gender: string;
  };
  canManage: boolean;
  onRefresh: () => void;
}

export function StepPlayers({ eventId, cls, canManage, onRefresh }: StepPlayersProps) {
  const [players, setPlayers] = useState<{ playerId: string; player: Player }[]>([]);
  const [pairs, setPairs] = useState<EventPair[]>([]);
  const [requests, setRequests] = useState<PairRequest[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pairSelection, setPairSelection] = useState<Set<string>>(new Set());
  const [pairingBusy, setPairingBusy] = useState(false);

  const fetchData = useCallback(async () => {
    const [eventRes, reqRes] = await Promise.all([
      fetch(`/api/events/${eventId}`),
      cls.format === "doubles" ? fetch(`/api/events/${eventId}/classes/${cls.id}/pair-request`) : null,
    ]);
    if (eventRes.ok) {
      const data = await eventRes.json();
      setPlayers((data.players || []).filter((ep: { classId?: string }) => ep.classId === cls.id));
      setPairs((data.pairs || []).filter((p: { classId?: string }) => p.classId === cls.id));
    }
    if (reqRes?.ok) setRequests(await reqRes.json());
    setLoading(false);
  }, [eventId, cls.id, cls.format]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const addPlayer = async (playerId: string) => {
    await fetch(`/api/events/${eventId}/classes/${cls.id}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    fetchData();
    onRefresh();
  };

  const removePlayer = async (playerId: string) => {
    const r = await fetch(`/api/events/${eventId}/classes/${cls.id}/signup`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({ error: "Failed to remove" }));
      alert(data.error || "Cannot remove player");
      return;
    }
    fetchData();
    onRefresh();
  };

  const forcePair = async (player1Id: string, player2Id: string) => {
    setPairingBusy(true);
    // Optimistic: add pair immediately
    const p1 = players.find((p) => p.playerId === player1Id)?.player;
    const p2 = players.find((p) => p.playerId === player2Id)?.player;
    if (p1 && p2) {
      setPairs((prev) => [...prev, {
        id: `temp-${Date.now()}`, player1: p1, player2: p2,
        player1Id, player2Id, classId: cls.id,
      }]);
    }
    setPairSelection(new Set());
    // Await API so data is saved before user navigates away
    await fetch(`/api/events/${eventId}/classes/${cls.id}/pair-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "force_pair", player1Id, player2Id }),
    });
    setPairingBusy(false);
  };

  const unpair = async (pairId: string) => {
    if (!confirm("Remove this pair?")) return;
    // Optimistic: remove pair immediately
    setPairs((prev) => prev.filter((p) => p.id !== pairId));
    // Await API so data is saved before user navigates away
    await fetch(`/api/events/${eventId}/pairs`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairId }),
    });
  };

  const acceptRequest = async (requestId: string) => {
    await fetch(`/api/events/${eventId}/classes/${cls.id}/pair-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept", requestId }),
    });
    fetchData();
    onRefresh();
  };

  const declineRequest = async (requestId: string) => {
    await fetch(`/api/events/${eventId}/classes/${cls.id}/pair-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "decline", requestId }),
    });
    fetchData();
  };

  if (loading) return <div className="text-xs text-muted py-4 text-center">Loading...</div>;

  const pairedPlayerIds = new Set<string>();
  pairs.forEach((p) => { pairedPlayerIds.add(p.player1Id); pairedPlayerIds.add(p.player2Id); });
  const unpairedPlayers = players.filter((ep) => !pairedPlayerIds.has(ep.playerId));
  const classPlayerIds = new Set(players.map((p) => p.playerId));
  const pendingRequests = requests.filter((r) => r.status === "pending");
  const isDoubles = cls.format === "doubles";

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">
            {players.length} player{players.length !== 1 ? "s" : ""}
            {isDoubles && ` · ${pairs.length} pair${pairs.length !== 1 ? "s" : ""}`}
            {isDoubles && unpairedPlayers.length > 0 && (
              <span className="text-amber-600 font-normal"> · {unpairedPlayers.length} unpaired</span>
            )}
          </h4>
          {canManage && !showAdd && (
            <button onClick={() => { setShowAdd(true); fetch("/api/players").then((r) => r.ok ? r.json() : []).then(setAllPlayers); }}
              className="text-xs text-action font-medium">+ Add Player</button>
          )}
        </div>
      </div>

      {/* Existing pairs */}
      {isDoubles && pairs.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="text-[10px] text-muted px-3 pt-2 pb-1 uppercase tracking-wider font-medium">Pairs</div>
          {pairs.map((pair) => {
            const p1Violation = cls.gender === "mix"
              ? !!(pair.player1.gender && pair.player2.gender && pair.player1.gender === pair.player2.gender)
              : (cls.gender === "male" && pair.player1.gender === "F") || (cls.gender === "female" && pair.player1.gender === "M");
            const p2Violation = cls.gender === "mix"
              ? p1Violation
              : (cls.gender === "male" && pair.player2.gender === "F") || (cls.gender === "female" && pair.player2.gender === "M");
            const GenderBadge = ({ show }: { show: boolean }) => show ? (
              <button
                onClick={(e) => { e.stopPropagation(); alert(cls.gender === "mix" ? "Mixed class requires one male and one female player" : `This player's gender doesn't match the ${cls.gender} class`); }}
                className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-amber-500 text-white rounded-full flex items-center justify-center text-[8px] font-bold leading-none"
                title="Gender mismatch"
              >⚠</button>
            ) : null;
            return (
              <div key={pair.id} className="group flex items-center gap-2 py-2 px-3 border-b border-border last:border-b-0">
                <div className="flex -space-x-1">
                  <div className="relative"><PlayerAvatar name={pair.player1.name} photoUrl={pair.player1.photoUrl} size="xs" /><GenderBadge show={!!p1Violation} /></div>
                  <div className="relative"><PlayerAvatar name={pair.player2.name} photoUrl={pair.player2.photoUrl} size="xs" /><GenderBadge show={!!p2Violation} /></div>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{pair.player1.name} & {pair.player2.name}</span>
                </div>
                {canManage && (
                  <button onClick={() => unpair(pair.id)}
                    className="text-[10px] text-danger px-1.5 py-0.5 rounded hover:bg-red-50">Unpair</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pending pair requests */}
      {isDoubles && pendingRequests.length > 0 && (
        <div className="bg-card rounded-xl border border-amber-200 overflow-hidden">
          <div className="text-[10px] text-amber-700 px-3 pt-2 pb-1 uppercase tracking-wider font-medium">Pending Requests</div>
          {pendingRequests.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-2 px-3 border-b border-amber-100 last:border-b-0 bg-amber-50/50">
              <PlayerAvatar name={r.requester.name} photoUrl={r.requester.photoUrl} size="xs" />
              <span className="text-sm flex-1">
                <span className="font-medium">{r.requester.name}</span>
                <span className="text-muted"> → </span>
                <span className="font-medium">{r.requested.name}</span>
              </span>
              <PlayerAvatar name={r.requested.name} photoUrl={r.requested.photoUrl} size="xs" />
              {canManage && (
                <>
                  <button onClick={() => acceptRequest(r.id)}
                    className="text-[10px] bg-green-600 text-white px-2 py-0.5 rounded font-medium">Pair</button>
                  <button onClick={() => declineRequest(r.id)}
                    className="text-[10px] text-danger px-1.5 py-0.5 rounded hover:bg-red-50">Decline</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Unpaired players */}
      {isDoubles && unpairedPlayers.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="text-[10px] text-muted px-3 pt-2 pb-1 uppercase tracking-wider font-medium">
            Unpaired Players
            {canManage && pairSelection.size === 0 && <span className="text-action ml-1 normal-case">(select two to pair)</span>}
          </div>
          {unpairedPlayers.map((ep) => {
            const isSelected = pairSelection.has(ep.playerId);
            const genderWarn = (cls.gender === "male" && ep.player.gender === "F") || (cls.gender === "female" && ep.player.gender === "M");
            return (
              <button key={ep.playerId}
                disabled={pairingBusy || (!isSelected && pairSelection.size >= 2)}
                onClick={() => {
                  if (!canManage) return;
                  setPairSelection((prev) => {
                    const next = new Set(prev);
                    if (next.has(ep.playerId)) { next.delete(ep.playerId); }
                    else if (next.size < 2) { next.add(ep.playerId); }
                    return next;
                  });
                }}
                className={`w-full flex items-center gap-2 py-2 px-3 border-b border-border last:border-b-0 transition-colors ${
                  genderWarn ? "bg-amber-50" : isSelected ? "bg-action/10" : pairSelection.size >= 2 ? "opacity-40" : canManage ? "hover:bg-gray-50" : ""
                }`}>
                <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
                <div className="flex-1 text-left min-w-0">
                  <span className="text-sm font-medium">{ep.player.name}</span>
                  {genderWarn && <span className="text-[10px] text-amber-600 block">Gender doesn&apos;t match class</span>}
                </div>
                {ep.player.gender && (
                  <span className={`text-[10px] ${ep.player.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
                    {ep.player.gender === "M" ? "♂" : "♀"}
                  </span>
                )}
                <span className="text-xs text-muted">{Math.round(ep.player.rating)}</span>
                {isSelected && <span className="text-[10px] text-action font-medium">✓</span>}
              </button>
            );
          })}
          {/* Pair button — shown when 2 selected */}
          {pairSelection.size === 2 && !pairingBusy && (() => {
            const [aId, bId] = [...pairSelection];
            const pA = unpairedPlayers.find((ep) => ep.playerId === aId);
            const pB = unpairedPlayers.find((ep) => ep.playerId === bId);
            const isMixClass = cls.gender === "mix";
            const sameGender = isMixClass && pA?.player.gender && pB?.player.gender && pA.player.gender === pB.player.gender;
            return (
            <div className="px-3 py-2.5 space-y-1.5">
              {sameGender && (
                <p className="text-xs text-amber-600 font-medium">Warning: same gender pair in a mixed class</p>
              )}
              <div className="flex gap-2">
              <button
                onClick={() => {
                  forcePair(aId, bId);
                }}
                className="flex-1 bg-action text-white py-2 rounded-lg text-sm font-semibold active:bg-action-dark">
                Pair Selected
              </button>
              <button onClick={() => setPairSelection(new Set())}
                className="px-4 py-2 rounded-lg text-sm text-muted bg-gray-100 hover:bg-gray-200">
                Clear
              </button>
              </div>
            </div>
            );
          })()}
          {pairingBusy && (
            <div className="px-3 py-2 bg-green-50 text-xs text-green-700 font-medium animate-pulse">
              Pairing...
            </div>
          )}
        </div>
      )}

      {/* All players (singles or full list) */}
      {!isDoubles && players.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="text-[10px] text-muted px-3 pt-2 pb-1 uppercase tracking-wider font-medium">Players</div>
          {players.map((ep) => {
            const genderWarn = (cls.gender === "male" && ep.player.gender === "F") || (cls.gender === "female" && ep.player.gender === "M");
            return (
            <div key={ep.playerId} className={`group flex items-center gap-2 py-2 px-3 border-b border-border last:border-b-0 ${genderWarn ? "bg-amber-50" : ""}`}>
              <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{ep.player.name}</span>
                {genderWarn && <span className="text-[10px] text-amber-600 block">Gender doesn&apos;t match class</span>}
              </div>
              <span className="text-xs text-muted">{Math.round(ep.player.rating)}</span>
              {canManage && (
                <button onClick={() => removePlayer(ep.playerId)}
                  className="hidden group-hover:block text-[10px] text-danger px-1.5 py-0.5 rounded hover:bg-red-50">Remove</button>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* Add player (manager) */}
      {showAdd && canManage && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Add players to this class</span>
            <button onClick={() => setShowAdd(false)} className="text-xs text-muted">Done</button>
          </div>
          <PlayerSelector
            players={allPlayers.filter((p) => !classPlayerIds.has(p.id)) as { id: string; name: string; gender?: string | null }[]}
            selectedIds={new Set()}
            onToggle={addPlayer}
          />
        </div>
      )}
    </div>
  );
}
