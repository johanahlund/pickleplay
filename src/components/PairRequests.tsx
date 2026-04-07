"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";

interface Player {
  id: string;
  name: string;
  emoji: string;
}

interface PairRequest {
  id: string;
  requesterId: string;
  requestedId: string;
  status: string;
  requester: Player;
  requested: Player;
}

interface PairRequestsProps {
  eventId: string;
  classId: string;
  format: string;
  players: { playerId: string; player: Player }[];
  existingPairPlayerIds: Set<string>;
  canManage: boolean;
  onPairCreated: () => void;
}

export function PairRequests({ eventId, classId, format, players, existingPairPlayerIds, canManage, onPairCreated }: PairRequestsProps) {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const [requests, setRequests] = useState<PairRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRequests = useCallback(async () => {
    const r = await fetch(`/api/events/${eventId}/classes/${classId}/pair-request`);
    if (r.ok) setRequests(await r.json());
    setLoading(false);
  }, [eventId, classId]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  if (format !== "doubles") return null;

  const api = async (action: string, data: Record<string, string>) => {
    await fetch(`/api/events/${eventId}/classes/${classId}/pair-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...data }),
    });
    await fetchRequests();
    if (action === "accept" || action === "force_pair") onPairCreated();
  };

  // My status
  const myPendingOutgoing = requests.find((r) => r.requesterId === userId && r.status === "pending");
  const myPendingIncoming = requests.filter((r) => r.requestedId === userId && r.status === "pending");
  const myAccepted = requests.find((r) => (r.requesterId === userId || r.requestedId === userId) && r.status === "accepted");
  const hasPair = myAccepted || (userId && existingPairPlayerIds.has(userId));

  // Available partners (in class, no confirmed pair, not me)
  const available = players.filter((p) =>
    p.playerId !== userId &&
    !existingPairPlayerIds.has(p.playerId)
  );

  if (loading) return null;

  return (
    <div className="space-y-2">
      {/* My confirmed pair — same style as others but name highlighted */}
      {myAccepted && (() => {
        const partner = myAccepted.requesterId === userId ? myAccepted.requested : myAccepted.requester;
        const me = myAccepted.requesterId === userId ? myAccepted.requester : myAccepted.requested;
        return (
          <div className="flex items-center gap-2 py-2 px-3 bg-card rounded-lg border border-border">
            <span className="text-sm"><span className="font-bold text-action">{me.name}</span> <span className="text-muted">&</span> <span className="font-medium">{partner.name}</span></span>
            <span className="flex-1" />
            <button onClick={async () => {
              if (!confirm(`Unpair from ${partner.name}?`)) return;
              if (!confirm(`Are you really sure? You will need to find a new partner.`)) return;
              const r = await fetch(`/api/events/${eventId}/classes/${classId}/pair-request`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "unpair", requestId: myAccepted.id }),
              });
              if (r.ok) { await fetchRequests(); onPairCreated(); }
              else { const d = await r.json().catch(() => ({})); alert(d.error || "Cannot unpair"); }
            }} className="text-[10px] text-danger px-2 py-0.5 rounded hover:bg-red-50">Unpair</button>
          </div>
        );
      })()}

      {/* Incoming requests */}
      {myPendingIncoming.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-amber-700">Partner requests:</span>
          {myPendingIncoming.map((r) => (
            <div key={r.id} className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              <span className="text-sm">{r.requester.emoji}</span>
              <span className="text-sm font-medium flex-1">{r.requester.name} wants to partner with you</span>
              <button onClick={() => api("accept", { requestId: r.id })}
                className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg font-medium">Accept</button>
              <button onClick={() => api("decline", { requestId: r.id })}
                className="text-xs text-danger px-2 py-1 rounded hover:bg-red-50">Decline</button>
            </div>
          ))}
        </div>
      )}

      {/* My outgoing request */}
      {myPendingOutgoing && !hasPair && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-2.5">
          <span className="text-sm">⏳</span>
          <span className="text-sm flex-1">
            Waiting for <span className="font-medium">{myPendingOutgoing.requested.name}</span> to accept
          </span>
          <button onClick={() => api("cancel", { requestId: myPendingOutgoing.id })}
            className="text-xs text-muted px-2 py-1 rounded hover:bg-gray-100">Cancel</button>
        </div>
      )}

      {/* Select partner */}
      {!hasPair && !myPendingOutgoing && userId && available.length > 0 && (
        <div>
          <span className="text-xs text-muted">Select partner:</span>
          <div className="space-y-1 mt-1">
            {available.map((p) => {
              const hasIncomingFromThem = requests.some((r) => r.requesterId === p.playerId && r.requestedId === userId && r.status === "pending");
              return (
                <button key={p.playerId} onClick={() => api("request", { partnerId: p.playerId })}
                  className={`w-full text-left py-2 px-3 rounded-lg flex items-center gap-2 transition-colors ${
                    hasIncomingFromThem ? "bg-amber-50 border border-amber-200" : "hover:bg-gray-50 border border-transparent"
                  }`}>
                  <span className="text-lg">{p.player.emoji}</span>
                  <span className="text-sm font-medium flex-1">{p.player.name}</span>
                  {hasIncomingFromThem && <span className="text-[10px] text-amber-700 font-medium">Wants you!</span>}
                  <span className="text-xs text-action">Request</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Admin: force pair */}
      {canManage && available.length >= 2 && (
        <details className="text-xs">
          <summary className="text-muted cursor-pointer font-medium">Admin: force pair</summary>
          <div className="mt-1 space-y-1">
            {requests.filter((r) => r.status === "pending").map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-1 px-2 rounded bg-gray-50">
                <span className="flex-1">{r.requester.name} → {r.requested.name}</span>
                <button onClick={() => api("accept", { requestId: r.id })}
                  className="text-[10px] text-action font-medium">Force accept</button>
              </div>
            ))}
            <p className="text-muted mt-1">Or use the Pairs section to manually create pairs.</p>
          </div>
        </details>
      )}
    </div>
  );
}
