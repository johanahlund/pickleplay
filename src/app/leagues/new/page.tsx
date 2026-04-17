"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_CATEGORIES = [
  { name: "Men's Doubles", format: "doubles", gender: "male", scoringFormat: "3x15", winBy: "2" },
  { name: "Women's Doubles", format: "doubles", gender: "female", scoringFormat: "3x15", winBy: "2" },
  { name: "Mixed Doubles", format: "doubles", gender: "mix", scoringFormat: "3x15", winBy: "2" },
  { name: "Singles", format: "singles", gender: "open", scoringFormat: "3x15", winBy: "2" },
];

interface MyClub { id: string; name: string; emoji: string; myRole: string }

export default function NewLeaguePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [season, setSeason] = useState("");
  const [clubId, setClubId] = useState("");
  const [ownedClubs, setOwnedClubs] = useState<MyClub[]>([]);
  const [loadingClubs, setLoadingClubs] = useState(true);
  const [maxRoster, setMaxRoster] = useState(14);
  const [maxPointsPerMatchDay, setMaxPointsPerMatchDay] = useState(3);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES.map((c) => ({ ...c, enabled: true, customFormat: "" })));
  const [scoringFormat, setScoringFormat] = useState("3x15");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/clubs");
      if (r.ok) {
        const clubs: MyClub[] = await r.json();
        const owned = clubs.filter((c) => c.myRole === "owner" || c.myRole === "admin");
        setOwnedClubs(owned);
        if (owned.length === 1) setClubId(owned[0].id);
      }
      setLoadingClubs(false);
    })();
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    if (!clubId) { alert("Please select an organizing club"); return; }
    setCreating(true);
    const enabledCats = categories.filter((c) => c.enabled).map(({ enabled: _enabled, customFormat, ...c }) => {
      void _enabled;
      return { ...c, scoringFormat: customFormat || scoringFormat };
    });
    const r = await fetch("/api/leagues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || undefined,
        season: season.trim() || undefined,
        clubId,
        config: { maxRoster, maxPointsPerMatchDay },
        categories: enabledCats,
      }),
    });
    if (r.ok) {
      const league = await r.json();
      router.push(`/leagues/${league.id}`);
    } else {
      setCreating(false);
      const d = await r.json().catch(() => ({}));
      alert(d.error || "Failed to create league");
    }
  };

  if (loadingClubs) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Create League</h2>
        <div className="flex justify-center py-8">
          <div className="w-5 h-5 border-2 border-action border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (ownedClubs.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Create League</h2>
        <div className="bg-card rounded-xl border border-border p-4 space-y-2">
          <p className="text-sm">Only club owners and admins can create leagues.</p>
          <p className="text-xs text-muted">You need to own or be an admin of a club before you can create a league. Visit the Clubs page to create one or ask an existing club owner to make you an admin.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Create League</h2>

      <div className="bg-card rounded-xl border border-border p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-muted mb-1">Organizing Club</label>
          <select value={clubId} onChange={(e) => setClubId(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">Select club...</option>
            {ownedClubs.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-muted mb-1">League Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. I Liga Interclubes" autoFocus
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>

        <div>
          <label className="block text-sm font-medium text-muted mb-1">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this league about?" rows={2}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-muted mb-1">Season</label>
            <input type="text" value={season} onChange={(e) => setSeason(e.target.value)}
              placeholder="e.g. 2026"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-muted mb-1">Max Roster</label>
            <input type="number" value={maxRoster} onChange={(e) => setMaxRoster(parseInt(e.target.value) || 14)} min={1}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-muted mb-1">Scoring Format</label>
            <select value={scoringFormat} onChange={(e) => setScoringFormat(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm">
              <option value="3x11">Best of 3, to 11</option>
              <option value="3x15">Best of 3, to 15</option>
              <option value="3x21">Best of 3, to 21</option>
              <option value="1x11">1 game to 11</option>
              <option value="1x15">1 game to 15</option>
              <option value="1x21">1 game to 21</option>
              <option value="1xR15">Rally to 15</option>
              <option value="1xR21">Rally to 21</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-muted mb-1">Max Points / Match Day</label>
            <input type="number" value={maxPointsPerMatchDay} onChange={(e) => setMaxPointsPerMatchDay(parseInt(e.target.value) || 3)} min={1}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-muted mb-2">Categories</label>
          <div className="space-y-2">
            {categories.map((cat, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50">
                <input type="checkbox" checked={cat.enabled} onChange={(e) => {
                  const next = [...categories];
                  next[i] = { ...next[i], enabled: e.target.checked };
                  setCategories(next);
                }} className="rounded" />
                <span className="text-sm font-medium flex-1">{cat.name}</span>
                <select value={cat.customFormat} onChange={(e) => {
                  const next = [...categories];
                  next[i] = { ...next[i], customFormat: e.target.value };
                  setCategories(next);
                }} className="text-[10px] border border-border rounded px-1.5 py-1 w-28">
                  <option value="">Default ({scoringFormat})</option>
                  <option value="3x11">Bo3 to 11</option>
                  <option value="3x15">Bo3 to 15</option>
                  <option value="3x21">Bo3 to 21</option>
                  <option value="1x11">1 set to 11</option>
                  <option value="1x15">1 set to 15</option>
                  <option value="1x21">1 set to 21</option>
                  <option value="1xR15">Rally 15</option>
                  <option value="1xR21">Rally 21</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        <button onClick={handleCreate} disabled={!name.trim() || !clubId || creating}
          className="w-full bg-action-dark text-white py-2.5 rounded-lg font-semibold transition-colors disabled:opacity-50">
          {creating ? "Creating..." : "Create League"}
        </button>
      </div>
    </div>
  );
}
