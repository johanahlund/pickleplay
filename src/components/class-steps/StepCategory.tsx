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

const PHASE_LABELS: Record<string, { label: string; color: string }> = {
  open: { label: "Open", color: "bg-green-100 text-green-700" },
  closed: { label: "Closed", color: "bg-amber-100 text-amber-700" },
  groups: { label: "Group", color: "bg-blue-100 text-blue-700" },
  bracket_upper: { label: "Bracket", color: "bg-purple-100 text-purple-700" },
  bracket_lower: { label: "Bracket", color: "bg-purple-100 text-purple-700" },
  completed: { label: "Completed", color: "bg-gray-100 text-gray-600" },
};

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

  const phase = cls.competitionPhase || "open";

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
          {Object.entries(PHASE_LABELS).map(([value, { label }]) => (
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
