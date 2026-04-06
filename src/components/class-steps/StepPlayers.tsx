"use client";

import { ClassPlayers } from "../ClassPlayers";

interface StepPlayersProps {
  eventId: string;
  cls: {
    id: string;
    format: string;
    minPlayers?: number | null;
    maxPlayers?: number | null;
    belowMinAction?: string | null;
  };
  allClasses: { id: string; name: string }[];
  canManage: boolean;
  updateField: (field: string, value: unknown) => void;
  onRefresh: () => void;
}

export function StepPlayers({ eventId, cls, allClasses, canManage, updateField, onRefresh }: StepPlayersProps) {
  const Toggle = ({ value, options, onChange }: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (v: string) => void;
  }) => (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => canManage && onChange(o.value)}
          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
            value === o.value ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
          } ${!canManage ? "cursor-default" : ""}`}>
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Players list */}
      <ClassPlayers eventId={eventId} classId={cls.id} format={cls.format} canManage={canManage} onRefresh={onRefresh} />

      {/* Copy from another class */}
      {canManage && allClasses.length > 1 && (
        <div className="bg-card rounded-xl border border-border p-3">
          <label className="block text-xs text-muted mb-1">Copy all settings from</label>
          <div className="flex gap-1.5">
            {allClasses.filter((c) => c.id !== cls.id).map((source) => (
              <button key={source.id} onClick={async () => {
                if (confirm(`Copy all settings from "${source.name}"?`)) {
                  await fetch(`/api/events/${eventId}/classes`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ classId: cls.id, copyFromId: source.id }),
                  });
                  onRefresh();
                }
              }}
                className="flex-1 py-2 rounded-lg text-xs font-medium bg-action/5 text-action border border-action/20 hover:bg-action/10">
                {source.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
