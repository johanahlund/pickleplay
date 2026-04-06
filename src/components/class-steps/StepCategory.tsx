"use client";


interface StepCategoryProps {
  cls: {
    format: string;
    gender: string;
    ageGroup: string;
    skillMin?: number | null;
    skillMax?: number | null;
    competitionPhase?: string | null;
  };
  canManage: boolean;
  updateField: (field: string, value: unknown) => void;
}

const DUPR_LEVELS = [null, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5];

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "groups", label: "Group" },
  { value: "bracket", label: "Bracket" },
  { value: "completed", label: "Completed" },
];

export function StepCategory({ cls, canManage, updateField }: StepCategoryProps) {

  const Toggle = ({ field, value, options }: { field: string; value: string; options: { value: string; label: string }[] }) => (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => canManage && updateField(field, o.value)}
          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
            value === o.value ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
          } ${!canManage ? "cursor-default" : ""}`}>
          {o.label}
        </button>
      ))}
    </div>
  );

  // Normalize bracket_upper/bracket_lower to bracket for display
  const rawPhase = cls.competitionPhase || "draft";
  const phase = rawPhase.startsWith("bracket") ? "bracket" : rawPhase;

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-4">
      {/* Status */}
      <div>
        <label className="block text-xs text-muted mb-1">Status</label>
        <select
          disabled={!canManage}
          value={phase}
          onChange={(e) => updateField("competitionPhase", e.target.value)}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium"
        >
          {STATUS_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-muted mb-1">Format</label>
        <Toggle field="format" value={cls.format} options={[
          { value: "doubles", label: "Doubles" },
          { value: "singles", label: "Singles" },
        ]} />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">Gender</label>
        <Toggle field="gender" value={cls.gender} options={[
          { value: "open", label: "Open" },
          { value: "male", label: "Male" },
          { value: "female", label: "Female" },
          { value: "mix", label: "Mixed" },
        ]} />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">Age Group</label>
        <select
          disabled={!canManage}
          value={cls.ageGroup}
          onChange={(e) => updateField("ageGroup", e.target.value)}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium"
        >
          <option value="open">Open</option>
          <option value="18+">18+</option>
          <option value="35+">35+</option>
          <option value="50+">50+</option>
          <option value="55+">55+</option>
          <option value="60+">60+</option>
          <option value="65+">65+</option>
          <option value="70+">70+</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">Level (DUPR)</label>
        <select
          disabled={!canManage}
          value={cls.skillMin ?? ""}
          onChange={(e) => {
            const val = e.target.value ? parseFloat(e.target.value) : null;
            updateField("skillMin", val);
            updateField("skillMax", null);
          }}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium"
        >
          {DUPR_LEVELS.map((lvl) => (
            <option key={lvl ?? "open"} value={lvl ?? ""}>{lvl ? lvl.toFixed(1) : "Open"}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
