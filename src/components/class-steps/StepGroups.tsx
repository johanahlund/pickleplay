"use client";

import { CompetitionConfig } from "@/lib/competition/types";

interface StepGroupsProps {
  config: CompetitionConfig;
  cls: {
    scoringFormat: string;
    winBy?: string;
  };
  maxTeams: number | null;
  registeredTeams: number;
  canManage: boolean;
  updateField: (field: string, value: unknown) => void;
  updateConfig: (partial: Partial<CompetitionConfig>) => void;
}

/** Returns array of group sizes, e.g. groupSizes(10, 3) → [4, 3, 3] */
function groupSizes(total: number, numGroups: number): number[] {
  if (numGroups <= 0) return [];
  const base = Math.floor(total / numGroups);
  const remainder = total % numGroups;
  return Array.from({ length: numGroups }, (_, i) => base + (i < remainder ? 1 : 0));
}

const SCORING_FORMAT_OPTIONS = [
  { group: "Normal — 1 Set", options: [
    { value: "1x7", label: "1 set to 7" },
    { value: "1x9", label: "1 set to 9" },
    { value: "1x11", label: "1 set to 11" },
    { value: "1x15", label: "1 set to 15" },
  ]},
  { group: "Normal — Best of 3", options: [
    { value: "3x11", label: "Best of 3 to 11" },
    { value: "3x15", label: "Best of 3 to 15" },
  ]},
  { group: "Rally — 1 Set", options: [
    { value: "1xR15", label: "1 set rally to 15" },
    { value: "1xR21", label: "1 set rally to 21" },
  ]},
  { group: "Rally — Best of 3", options: [
    { value: "3xR15", label: "Best of 3 rally to 15" },
    { value: "3xR21", label: "Best of 3 rally to 21" },
  ]},
];

export function StepGroups({ config, cls, maxTeams, registeredTeams, canManage, updateField, updateConfig }: StepGroupsProps) {
  const Toggle = ({ value, options, onChange }: {
    value: string | number;
    options: { value: string | number; label: string }[];
    onChange: (v: string | number) => void;
  }) => (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button key={String(o.value)} onClick={() => canManage && onChange(o.value)}
          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
            value === o.value ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
          } ${!canManage ? "cursor-default" : ""}`}>
          {o.label}
        </button>
      ))}
    </div>
  );

  const n = config.numGroups;

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-4">
      <div>
        <label className="block text-xs text-muted mb-1">Groups</label>
        <div className="flex gap-3">
          {/* Group selector */}
          <div className="flex items-center gap-0 shrink-0">
            <button onClick={() => canManage && updateConfig({ numGroups: Math.max(1, n - 1) })}
              className="w-12 h-12 rounded-l-xl bg-gray-200 text-foreground font-bold text-2xl flex items-center justify-center active:bg-gray-300">−</button>
            <div className="w-12 h-12 bg-selected text-white font-bold text-2xl flex items-center justify-center">{n}</div>
            <button onClick={() => canManage && updateConfig({ numGroups: Math.min(10, n + 1) })}
              className="w-12 h-12 rounded-r-xl bg-gray-200 text-foreground font-bold text-2xl flex items-center justify-center active:bg-gray-300">+</button>
          </div>

          {/* Distribution info */}
          <div className="flex-1 min-w-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted">
                  <th className="text-left font-normal pb-1"></th>
                  {maxTeams != null && <th className="text-center font-normal pb-1">Max</th>}
                  <th className="text-center font-normal pb-1">Reg</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="text-muted pr-2">Teams</td>
                  {maxTeams != null && <td className="text-center font-semibold">{maxTeams}</td>}
                  <td className="text-center font-semibold">{registeredTeams}</td>
                </tr>
                <tr>
                  <td className="text-muted pr-2">Per grp</td>
                  {maxTeams != null && (
                    <td className="text-center text-[10px]">
                      {n > 0 ? groupSizes(maxTeams, n).join(" · ") : "–"}
                    </td>
                  )}
                  <td className="text-center text-[10px]">
                    {n > 0 ? groupSizes(registeredTeams, n).join(" · ") : "–"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Scoring */}
      <div>
        <label className="block text-xs text-muted mb-1">Scoring</label>
        <select
          disabled={!canManage}
          value={cls.scoringFormat || "1x11"}
          onChange={(e) => updateField("scoringFormat", e.target.value)}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium"
        >
          {SCORING_FORMAT_OPTIONS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-muted mb-1">Win by</label>
        <select
          disabled={!canManage}
          value={cls.winBy || "2"}
          onChange={(e) => updateField("winBy", e.target.value)}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium"
        >
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="cap13">Cap 13</option>
          <option value="cap15">Cap 15</option>
          <option value="cap17">Cap 17</option>
          <option value="cap18">Cap 18</option>
          <option value="cap23">Cap 23</option>
          <option value="cap25">Cap 25</option>
        </select>
      </div>

      <div>
        <label className="block text-xs text-muted mb-1">Matches per matchup in group</label>
        <Toggle value={config.matchesPerMatchup} options={[
          { value: 1, label: "Once" },
          { value: 2, label: "Twice" },
        ]} onChange={(v) => updateConfig({ matchesPerMatchup: v as number })} />
      </div>

      <div>
        <label className="block text-xs text-muted mb-1">Group seeding</label>
        <select
          disabled={!canManage}
          value={config.groupSeeding}
          onChange={(e) => updateConfig({ groupSeeding: e.target.value as CompetitionConfig["groupSeeding"] })}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium"
        >
          <option value="rating">App Rating</option>
          <option value="dupr">DUPR Rating</option>
          <option value="skill_level">Skill Level</option>
          <option value="random">Random</option>
        </select>
      </div>
    </div>
  );
}
