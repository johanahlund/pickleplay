"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_CATEGORIES = [
  { name: "Men's Doubles", format: "doubles", gender: "male", scoringFormat: "3x15", winBy: "2" },
  { name: "Women's Doubles", format: "doubles", gender: "female", scoringFormat: "3x15", winBy: "2" },
  { name: "Mixed Doubles", format: "doubles", gender: "mix", scoringFormat: "3x15", winBy: "2" },
  { name: "Singles", format: "singles", gender: "open", scoringFormat: "3x15", winBy: "2" },
];

export default function NewLeaguePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [season, setSeason] = useState("");
  const [maxRoster, setMaxRoster] = useState(14);
  const [maxPointsPerMatchDay, setMaxPointsPerMatchDay] = useState(3);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES.map((c) => ({ ...c, enabled: true, customFormat: "" })));
  const [scoringFormat, setScoringFormat] = useState("3x15");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    const enabledCats = categories.filter((c) => c.enabled).map(({ enabled, customFormat, ...c }) => ({
      ...c,
      scoringFormat: customFormat || scoringFormat, // category override or league default
    }));
    const r = await fetch("/api/leagues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || undefined,
        season: season.trim() || undefined,
        config: { maxRoster, maxPointsPerMatchDay },
        categories: enabledCats,
      }),
    });
    if (r.ok) {
      const league = await r.json();
      router.push(`/leagues/${league.id}`);
    } else {
      setCreating(false);
      alert("Failed to create league");
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Create League</h2>

      <div className="bg-card rounded-xl border border-border p-4 space-y-4">
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

        <button onClick={handleCreate} disabled={!name.trim() || creating}
          className="w-full bg-action-dark text-white py-2.5 rounded-lg font-semibold transition-colors disabled:opacity-50">
          {creating ? "Creating..." : "Create League"}
        </button>
      </div>
    </div>
  );
}
