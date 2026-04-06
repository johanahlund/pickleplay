"use client";

import { useState } from "react";

interface Session {
  id: string;
  name: string;
  date: string;
  endDate?: string | null;
  numCourts: number;
  status: string;
  _count?: { matches: number };
}

interface SessionsManagerProps {
  eventId: string;
  sessions: Session[];
  canManage: boolean;
  onRefresh: () => void;
}

export function SessionsManager({ eventId, sessions, canManage, onRefresh }: SessionsManagerProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("09:00");
  const [newEndTime, setNewEndTime] = useState("11:00");
  const [newCourts, setNewCourts] = useState(2);
  const [creating, setCreating] = useState(false);

  const addSession = async () => {
    if (!newName.trim() || !newDate) return;
    setCreating(true);
    const date = new Date(`${newDate}T${newTime}`);
    const endDate = new Date(`${newDate}T${newEndTime}`);
    if (endDate <= date) endDate.setDate(endDate.getDate() + 1);
    await fetch(`/api/events/${eventId}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), date: date.toISOString(), endDate: endDate.toISOString(), numCourts: newCourts }),
    });
    setCreating(false);
    setShowAdd(false);
    setNewName("");
    setNewDate("");
    onRefresh();
  };

  const deleteSession = async (sessionId: string, name: string) => {
    if (!confirm(`Delete session "${name}"? Matches will be unlinked (not deleted).`)) return;
    await fetch(`/api/events/${eventId}/sessions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    onRefresh();
  };

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Sessions</h4>
        {canManage && !showAdd && (
          <button onClick={() => setShowAdd(true)} className="text-xs text-action font-medium">+ Add Session</button>
        )}
      </div>

      {sessions.length === 0 && !showAdd && (
        <p className="text-xs text-muted text-center py-2">No sessions scheduled yet</p>
      )}

      {sessions.map((s) => {
        const isPast = new Date(s.endDate || s.date) < new Date();
        const isToday = new Date(s.date).toDateString() === new Date().toDateString();
        return (
          <div key={s.id} className={`group flex items-center gap-3 py-2 px-3 rounded-lg ${isPast ? "opacity-50 bg-gray-50" : isToday ? "bg-green-50 border border-green-200" : "bg-gray-50"}`}>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium">{s.name}</span>
              <div className="flex gap-2 text-[10px] text-muted mt-0.5">
                <span>{new Date(s.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
                <span>{new Date(s.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  {s.endDate && ` – ${new Date(s.endDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}</span>
                <span>{s.numCourts} court{s.numCourts !== 1 ? "s" : ""}</span>
                {s._count?.matches !== undefined && <span>{s._count.matches} match{s._count.matches !== 1 ? "es" : ""}</span>}
              </div>
            </div>
            {isToday && <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">Today</span>}
            {canManage && (
              <button onClick={() => deleteSession(s.id, s.name)}
                className="hidden group-hover:block text-[10px] text-danger px-1.5 py-0.5 rounded hover:bg-red-50">Remove</button>
            )}
          </div>
        );
      })}

      {showAdd && (
        <div className="border-t border-border pt-3 space-y-2">
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Week 1 - Saturday" autoFocus
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          <div className="flex gap-2">
            <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)}
              className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            <input type="time" value={newEndTime} onChange={(e) => setNewEndTime(e.target.value)}
              className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div className="flex gap-2">
            <button onClick={addSession} disabled={!newName.trim() || !newDate || creating}
              className="flex-1 bg-action text-white py-2 rounded-lg font-medium text-sm active:bg-action-dark disabled:opacity-50">
              {creating ? "Creating..." : "Add"}
            </button>
            <button onClick={() => setShowAdd(false)}
              className="flex-1 bg-gray-100 text-foreground py-2 rounded-lg font-medium text-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
