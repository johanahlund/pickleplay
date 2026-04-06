"use client";

import { useEffect, useState, useCallback } from "react";
import { PlayerSelector } from "../PlayerSelector";

interface Player {
  id: string;
  name: string;
  emoji: string;
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
  const [manualPairSelection, setManualPairSelection] = useState<string | null>(null);

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
    if (!confirm("Remove this player?")) return;
    await fetch(`/api/events/${eventId}/classes/${cls.id}/signup`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    fetchData();
    onRefresh();
  };

  const forcePair = async (player1Id: string, player2Id: string) => {
    await fetch(`/api/events/${eventId}/classes/${cls.id}/pair-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "force_pair", player1Id, player2Id }),
    });
    setManualPairSelection(null);
    fetchData();
    onRefresh();
  };

  const unpair = async (pairId: string) => {
    if (!confirm("Remove this pair?")) return;
    await fetch(`/api/events/${eventId}/pairs`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairId }),
    });
    fetchData();
    onRefresh();
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
          {pairs.map((pair) => (
            <div key={pair.id} className="group flex items-center gap-2 py-2 px-3 border-b border-border last:border-b-0">
              <span className="text-sm">{pair.player1.emoji}{pair.player2.emoji}</span>
              <span className="text-sm font-medium flex-1">{pair.player1.name} & {pair.player2.name}</span>
              {canManage && (
                <button onClick={() => unpair(pair.id)}
                  className="hidden group-hover:block text-[10px] text-danger px-1.5 py-0.5 rounded hover:bg-red-50">Unpair</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pending pair requests */}
      {isDoubles && pendingRequests.length > 0 && (
        <div className="bg-card rounded-xl border border-amber-200 overflow-hidden">
          <div className="text-[10px] text-amber-700 px-3 pt-2 pb-1 uppercase tracking-wider font-medium">Pending Requests</div>
          {pendingRequests.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-2 px-3 border-b border-amber-100 last:border-b-0 bg-amber-50/50">
              <span className="text-sm">{r.requester.emoji}</span>
              <span className="text-sm flex-1">
                <span className="font-medium">{r.requester.name}</span>
                <span className="text-muted"> → </span>
                <span className="font-medium">{r.requested.name}</span> {r.requested.emoji}
              </span>
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
            {canManage && <span className="text-action ml-1 normal-case">(tap two to pair)</span>}
          </div>
          {unpairedPlayers.map((ep) => {
            const isSelected = manualPairSelection === ep.playerId;
            return (
              <button key={ep.playerId}
                onClick={() => {
                  if (!canManage) return;
                  if (!manualPairSelection) {
                    setManualPairSelection(ep.playerId);
                  } else if (manualPairSelection === ep.playerId) {
                    setManualPairSelection(null);
                  } else {
                    forcePair(manualPairSelection, ep.playerId);
                  }
                }}
                className={`w-full flex items-center gap-2 py-2 px-3 border-b border-border last:border-b-0 transition-colors ${
                  isSelected ? "bg-action/10" : canManage ? "hover:bg-gray-50" : ""
                }`}>
                <span className="text-lg">{ep.player.emoji}</span>
                <span className="text-sm font-medium flex-1 text-left">{ep.player.name}</span>
                {ep.player.gender && (
                  <span className={`text-[10px] ${ep.player.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
                    {ep.player.gender === "M" ? "♂" : "♀"}
                  </span>
                )}
                <span className="text-xs text-muted">{Math.round(ep.player.rating)}</span>
                {isSelected && <span className="text-[10px] text-action font-medium">Selected</span>}
              </button>
            );
          })}
          {manualPairSelection && (
            <div className="px-3 py-2 bg-action/5 text-xs text-action font-medium">
              Tap another player to pair, or tap again to deselect
            </div>
          )}
        </div>
      )}

      {/* All players (singles or full list) */}
      {!isDoubles && players.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="text-[10px] text-muted px-3 pt-2 pb-1 uppercase tracking-wider font-medium">Players</div>
          {players.map((ep) => (
            <div key={ep.playerId} className="group flex items-center gap-2 py-2 px-3 border-b border-border last:border-b-0">
              <span className="text-lg">{ep.player.emoji}</span>
              <span className="text-sm font-medium flex-1">{ep.player.name}</span>
              <span className="text-xs text-muted">{Math.round(ep.player.rating)}</span>
              {canManage && (
                <button onClick={() => removePlayer(ep.playerId)}
                  className="hidden group-hover:block text-[10px] text-danger px-1.5 py-0.5 rounded hover:bg-red-50">Remove</button>
              )}
            </div>
          ))}
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
