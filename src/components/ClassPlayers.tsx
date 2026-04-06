"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { PlayerSelector } from "./PlayerSelector";

interface Player {
  id: string;
  name: string;
  emoji: string;
  gender?: string | null;
  rating: number;
}

interface ClassPlayer {
  id: string;
  playerId: string;
  status: string;
  player: Player;
}

interface ClassPlayersProps {
  eventId: string;
  classId: string;
  format: string;
  canManage: boolean;
  onRefresh: () => void;
}

export function ClassPlayers({ eventId, classId, format, canManage, onRefresh }: ClassPlayersProps) {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const [players, setPlayers] = useState<ClassPlayer[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchClassPlayers = useCallback(async () => {
    // Get event data which includes players with classId
    const r = await fetch(`/api/events/${eventId}`);
    if (!r.ok) return;
    const data = await r.json();
    const classPlayers = (data.players || []).filter((ep: { classId?: string }) => ep.classId === classId);
    setPlayers(classPlayers);
    setLoading(false);
  }, [eventId, classId]);

  useEffect(() => { fetchClassPlayers(); }, [fetchClassPlayers]);

  const fetchAllPlayers = async () => {
    const r = await fetch("/api/players");
    if (r.ok) setAllPlayers(await r.json());
  };

  const addPlayer = async (playerId: string) => {
    await fetch(`/api/events/${eventId}/classes/${classId}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    await fetchClassPlayers();
    onRefresh();
  };

  const removePlayer = async (playerId: string) => {
    await fetch(`/api/events/${eventId}/classes/${classId}/signup`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    await fetchClassPlayers();
    onRefresh();
  };

  const selfSignup = async () => {
    await fetch(`/api/events/${eventId}/classes/${classId}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await fetchClassPlayers();
    onRefresh();
  };

  const selfLeave = async () => {
    await fetch(`/api/events/${eventId}/classes/${classId}/signup`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await fetchClassPlayers();
    onRefresh();
  };

  const classPlayerIds = new Set(players.map((p) => p.playerId));
  const isSelf = userId ? classPlayerIds.has(userId) : false;

  if (loading) return <div className="text-xs text-muted py-2">Loading players...</div>;

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">
          {format === "doubles" ? "Teams" : "Players"} ({players.length})
        </h4>
        {canManage && !showAdd && (
          <button onClick={() => { setShowAdd(true); fetchAllPlayers(); }}
            className="text-xs text-action font-medium">+ Add</button>
        )}
      </div>

      {/* Self-signup */}
      {!canManage && userId && !isSelf && (
        <button onClick={selfSignup}
          className="w-full py-2 text-sm font-medium bg-action text-white rounded-lg active:bg-action-dark">
          Join this class
        </button>
      )}
      {!canManage && isSelf && (
        <button onClick={selfLeave}
          className="text-xs text-danger hover:underline">Leave this class</button>
      )}

      {/* Player list */}
      {players.length === 0 ? (
        <p className="text-xs text-muted text-center py-2">No players yet</p>
      ) : (
        <div className="space-y-1">
          {players.map((ep) => (
            <div key={ep.id} className="group flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50">
              <span className="text-lg">{ep.player.emoji}</span>
              <span className="text-sm font-medium flex-1">{ep.player.name}</span>
              {ep.player.gender && (
                <span className={`text-[10px] ${ep.player.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
                  {ep.player.gender === "M" ? "♂" : "♀"}
                </span>
              )}
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
        <div className="border-t border-border pt-3 space-y-2">
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
