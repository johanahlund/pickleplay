"use client";

import { useState } from "react";

interface EventClass {
  id: string;
  name: string;
  isDefault: boolean;
  format: string;
  gender: string;
  ageGroup: string;
  scoringFormat: string;
  pairingMode: string;
  competitionMode?: string | null;
  minPlayers?: number | null;
  maxPlayers?: number | null;
  belowMinAction?: string | null;
  mergeWithClassId?: string | null;
}

interface ClassesManagerProps {
  eventId: string;
  classes: EventClass[];
  canManage: boolean;
  onRefresh: () => void;
  onClassSelect?: (classId: string) => void;
}

const GENDER_OPTIONS = [
  { value: "open", label: "Any Gender" },
  { value: "male", label: "Men" },
  { value: "female", label: "Women" },
  { value: "mix", label: "Mixed" },
];

const AGE_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "18+", label: "18+" },
  { value: "50+", label: "50+" },
  { value: "60+", label: "60+" },
];

const FORMAT_OPTIONS = [
  { value: "doubles", label: "Doubles" },
  { value: "singles", label: "Singles" },
];

function classLabel(cls: EventClass): string {
  const parts = [];
  if (cls.gender !== "open") parts.push(cls.gender === "male" ? "M" : cls.gender === "female" ? "W" : "MX");
  parts.push(cls.format === "doubles" ? "D" : "S");
  if (cls.ageGroup !== "open") parts.push(cls.ageGroup);
  return parts.join(" ") || cls.name;
}

export function ClassesManager({ eventId, classes, canManage, onRefresh, onClassSelect }: ClassesManagerProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFormat, setNewFormat] = useState("doubles");
  const [newGender, setNewGender] = useState("open");
  const [newAge, setNewAge] = useState("open");
  const [copyFromId, setCopyFromId] = useState<string>("");
  const [newMin, setNewMin] = useState("");
  const [newMax, setNewMax] = useState("");
  const [newBelowMin, setNewBelowMin] = useState("tbd");
  const [newMergeWith, setNewMergeWith] = useState("");
  const [creating, setCreating] = useState(false);
  const [copyingForId, setCopyingForId] = useState<string | null>(null);

  const addClass = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    await fetch(`/api/events/${eventId}/classes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        format: newFormat,
        gender: newGender,
        ageGroup: newAge,
        ...(newMin ? { minPlayers: parseInt(newMin) } : {}),
        ...(newMax ? { maxPlayers: parseInt(newMax) } : {}),
        belowMinAction: newBelowMin,
        ...(newBelowMin === "merge" && newMergeWith ? { mergeWithClassId: newMergeWith } : {}),
        ...(copyFromId ? { copyFromId } : {}),
      }),
    });
    setCreating(false);
    setShowAdd(false);
    setNewName("");
    setCopyFromId("");
    onRefresh();
  };

  const copySettings = async (classId: string, copyFromId: string) => {
    await fetch(`/api/events/${eventId}/classes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId, copyFromId }),
    });
    setCopyingForId(null);
    onRefresh();
  };

  const deleteClass = async (classId: string, className: string) => {
    if (!confirm(`Delete class "${className}"? Players and matches in this class will be unlinked.`)) return;
    await fetch(`/api/events/${eventId}/classes`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId }),
    });
    onRefresh();
  };

  // Auto-generate name from selections
  const autoName = () => {
    const parts = [];
    if (newGender !== "open") parts.push(newGender === "male" ? "Men's" : newGender === "female" ? "Women's" : "Mixed");
    parts.push(newFormat === "doubles" ? "Doubles" : "Singles");
    if (newAge !== "open") parts.push(newAge);
    return parts.join(" ");
  };

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Event Classes</h4>
        {canManage && !showAdd && (
          <button onClick={() => { setShowAdd(true); setNewName(autoName()); }}
            className="text-xs text-action font-medium">+ Add Class</button>
        )}
      </div>

      {/* Existing classes */}
      <div className="space-y-1.5">
        {classes.map((cls) => (
          <div key={cls.id} className="space-y-1">
            <div className="group flex items-center gap-2 py-2 px-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
              onClick={() => onClassSelect?.(cls.id)}>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium truncate">{cls.name}</span>
                <div className="flex gap-1.5 mt-0.5">
                  <span className="text-[10px] text-muted">{cls.format} · {cls.gender} · {cls.ageGroup}</span>
                  {(cls.minPlayers || cls.maxPlayers) && (
                    <span className="text-[10px] text-muted">· {cls.minPlayers || "?"}-{cls.maxPlayers || "∞"} {cls.format === "doubles" ? "teams" : "players"}</span>
                  )}
                </div>
              </div>
              {cls.isDefault && <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">Default</span>}
              {canManage && classes.length > 1 && (
                <button onClick={(e) => { e.stopPropagation(); setCopyingForId(copyingForId === cls.id ? null : cls.id); }}
                  className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${copyingForId === cls.id ? "bg-action/10 text-action" : "hidden group-hover:block text-muted hover:text-foreground hover:bg-gray-200"}`}>
                  Copy from
                </button>
              )}
              {canManage && !cls.isDefault && (
                <button onClick={(e) => { e.stopPropagation(); deleteClass(cls.id, cls.name); }}
                  className="hidden group-hover:block text-[10px] text-danger px-1.5 py-0.5 rounded hover:bg-red-50 shrink-0">Remove</button>
              )}
              <span className="text-muted text-sm shrink-0">›</span>
            </div>
            {/* Copy from selector */}
            {copyingForId === cls.id && (
              <div className="flex gap-1.5 px-3 pb-1">
                {classes.filter((c) => c.id !== cls.id).map((source) => (
                  <button key={source.id} onClick={() => {
                    if (confirm(`Copy competition settings from "${source.name}" to "${cls.name}"?`)) {
                      copySettings(cls.id, source.id);
                    }
                  }}
                    className="flex-1 py-1.5 rounded-lg text-[10px] font-medium bg-action/5 text-action border border-action/20 hover:bg-action/10 transition-colors">
                    {source.name}
                  </button>
                ))}
                <button onClick={() => setCopyingForId(null)}
                  className="text-[10px] text-muted px-2 hover:text-foreground">Cancel</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add class form */}
      {showAdd && (
        <div className="border-t border-border pt-3 space-y-3">
          <div>
            <label className="block text-xs text-muted mb-1">Format</label>
            <div className="flex gap-1.5">
              {FORMAT_OPTIONS.map((f) => (
                <button key={f.value} type="button"
                  onClick={() => { setNewFormat(f.value); setNewName(autoName()); }}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${newFormat === f.value ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Gender</label>
            <div className="flex gap-1.5">
              {GENDER_OPTIONS.map((g) => (
                <button key={g.value} type="button"
                  onClick={() => { setNewGender(g.value); setNewName(autoName()); }}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${newGender === g.value ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Age Group</label>
            <div className="flex gap-1.5">
              {AGE_OPTIONS.map((a) => (
                <button key={a.value} type="button"
                  onClick={() => { setNewAge(a.value); setNewName(autoName()); }}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${newAge === a.value ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Copy settings from another class */}
          {classes.length > 0 && (
            <div>
              <label className="block text-xs text-muted mb-1">Copy settings from</label>
              <select value={copyFromId} onChange={(e) => setCopyFromId(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">Start fresh</option>
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>{cls.name} (groups, scoring, pairing)</option>
                ))}
              </select>
              <p className="text-[10px] text-muted mt-0.5">Copies: scoring, sets, pairing mode, play mode, competition config</p>
            </div>
          )}

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-muted mb-1">Min {newFormat === "doubles" ? "teams" : "players"}</label>
              <input type="number" value={newMin} onChange={(e) => setNewMin(e.target.value)} placeholder="No min" min="1"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-muted mb-1">Max {newFormat === "doubles" ? "teams" : "players"}</label>
              <input type="number" value={newMax} onChange={(e) => setNewMax(e.target.value)} placeholder="No max" min="1"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">If below minimum</label>
            <div className="flex gap-1.5">
              {[
                { value: "tbd", label: "To be decided" },
                { value: "cancel", label: "Cancel class" },
                { value: "merge", label: "Merge with..." },
              ].map((a) => (
                <button key={a.value} type="button" onClick={() => setNewBelowMin(a.value)}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all ${newBelowMin === a.value ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                  {a.label}
                </button>
              ))}
            </div>
            {newBelowMin === "merge" && classes.length > 0 && (
              <select value={newMergeWith} onChange={(e) => setNewMergeWith(e.target.value)}
                className="w-full mt-1.5 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">Select class to merge with</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Class Name</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Men's Doubles 3.5"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>

          <div className="flex gap-2">
            <button onClick={addClass} disabled={!newName.trim() || creating}
              className="flex-1 bg-action text-white py-2 rounded-lg font-medium text-sm active:bg-action-dark disabled:opacity-50">
              {creating ? "Creating..." : "Add Class"}
            </button>
            <button onClick={() => setShowAdd(false)}
              className="flex-1 bg-gray-100 text-foreground py-2 rounded-lg font-medium text-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
