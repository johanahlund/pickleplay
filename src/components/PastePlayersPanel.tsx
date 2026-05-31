"use client";

import { useMemo, useState } from "react";
import { parsePlayerList } from "@/lib/parsePlayerList";
import { matchPlayers, type MatchPlayer, type MatchResult } from "@/lib/matchPlayers";
import { inferGender } from "@/lib/genderFromName";
import { PlayerAvatar } from "./PlayerAvatar";

export interface PastePlayersCreateInput {
  name: string;
  gender?: "M" | "F" | null;
  joinClub?: boolean;
}

export interface PastePlayersPanelProps {
  players: MatchPlayer[];
  /** IDs already in the selection — used to grey out and skip "Will add". */
  selectedIds: Set<string>;
  onClose: () => void;
  /** Add an existing player to the event. May be async. */
  onAddExisting: (id: string) => Promise<void> | void;
  /** Create a brand-new player. Resolves with the created player id. */
  onCreatePlayer: (input: PastePlayersCreateInput) => Promise<string>;
  /** If provided, the per-row "join {clubName}" checkbox appears for new players. */
  clubName?: string;
  /**
   * Members of the event's club. On an ambiguous name we assume the club
   * member — pre-selecting that candidate — but the row still needs the
   * organizer to confirm via Apply. Club members are also badged so the
   * default is visible.
   */
  clubMemberIds?: Set<string>;
}

type RowDecision =
  | { kind: "skip" }
  | { kind: "addExisting"; playerId: string }
  | { kind: "create"; name: string; gender: "M" | "F" | null; joinClub: boolean };

interface RowState {
  result: MatchResult;
  decision: RowDecision;
  /** override editing for create-mode name */
  createName: string;
  createGender: "M" | "F" | null;
  createJoinClub: boolean;
  /** for ambiguous: chosen candidate id (or "__new__" for create-new-instead) */
  chosenCandidate: string;
}

function defaultRow(
  result: MatchResult,
  selectedIds: Set<string>,
  defaultJoinClub: boolean,
  clubMemberIds?: Set<string>,
): RowState {
  const guessed = inferGender(result.line.name);
  // Default decision per status
  let decision: RowDecision;
  let chosenCandidate = result.candidates[0]?.id || "";
  if (result.status === "exact") {
    const c = result.candidates[0];
    if (selectedIds.has(c.id)) decision = { kind: "skip" };
    else decision = { kind: "addExisting", playerId: c.id };
  } else if (result.status === "ambiguous") {
    // Assume the club member when exactly one candidate belongs to the
    // club (and isn't already in the roster) — pre-select it, but leave
    // the row for the organizer to confirm via Apply.
    const clubCands = clubMemberIds
      ? result.candidates.filter((c) => clubMemberIds.has(c.id) && !selectedIds.has(c.id))
      : [];
    if (clubCands.length === 1) {
      decision = { kind: "addExisting", playerId: clubCands[0].id };
      chosenCandidate = clubCands[0].id;
    } else {
      decision = { kind: "skip" };
      chosenCandidate = "";
    }
  } else {
    decision = { kind: "create", name: result.line.name, gender: guessed, joinClub: defaultJoinClub };
  }
  return {
    result,
    decision,
    createName: result.line.name,
    createGender: guessed,
    createJoinClub: defaultJoinClub,
    chosenCandidate,
  };
}

export function PastePlayersPanel({
  players,
  selectedIds,
  onClose,
  onAddExisting,
  onCreatePlayer,
  clubName,
  clubMemberIds,
}: PastePlayersPanelProps) {
  const [step, setStep] = useState<"input" | "review">("input");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<RowState[]>([]);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<{ name: string; error: string }[]>([]);

  const handleParse = () => {
    const parsed = parsePlayerList(text);
    const matched = matchPlayers(parsed, players);
    setRows(matched.map((m) => defaultRow(m, selectedIds, false, clubMemberIds)));
    setStep("review");
  };

  const summary = useMemo(() => {
    const toAdd = rows.filter((r) => r.decision.kind === "addExisting").length;
    const toCreate = rows.filter((r) => r.decision.kind === "create").length;
    const skipped = rows.filter((r) => r.decision.kind === "skip").length;
    return { toAdd, toCreate, skipped };
  }, [rows]);

  const apply = async () => {
    setApplying(true);
    setErrors([]);
    const actions = rows.filter((r) => r.decision.kind !== "skip");
    setProgress({ done: 0, total: actions.length });
    const newErrors: { name: string; error: string }[] = [];
    let done = 0;
    for (const r of rows) {
      try {
        if (r.decision.kind === "addExisting") {
          await onAddExisting(r.decision.playerId);
          done++;
          setProgress({ done, total: actions.length });
        } else if (r.decision.kind === "create") {
          const id = await onCreatePlayer({
            name: r.createName.trim(),
            gender: r.createGender,
            joinClub: r.createJoinClub,
          });
          await onAddExisting(id);
          done++;
          setProgress({ done, total: actions.length });
        }
      } catch (e) {
        newErrors.push({ name: r.result.line.name, error: e instanceof Error ? e.message : String(e) });
      }
    }
    setErrors(newErrors);
    setApplying(false);
    if (newErrors.length === 0) {
      onClose();
    }
  };

  // === Render ===
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-2">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Paste players</h2>
          <button type="button" onClick={onClose} className="text-muted text-lg leading-none px-2" aria-label="Close">×</button>
        </div>

        {step === "input" && (
          <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden">
            <p className="text-xs text-muted">
              Paste a list, one name per line. Emoji and bullets are ignored.
              Each name is matched against existing players; anything unmatched can be created.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"🏓 Fernando B\n🏓 Alberto\n🏓 Ana Machado\n..."}
              className="flex-1 min-h-[200px] border border-border rounded-lg p-3 text-sm font-mono"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose}
                className="bg-gray-100 text-foreground py-2 px-4 rounded-lg text-sm font-medium">
                Cancel
              </button>
              <button type="button" onClick={handleParse}
                disabled={!text.trim()}
                className="bg-selected text-white py-2 px-4 rounded-lg text-sm font-medium disabled:opacity-50">
                Match names
              </button>
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-2 border-b border-border text-xs text-muted flex flex-wrap gap-3">
              <span><b className="text-green-700">{summary.toAdd}</b> existing</span>
              <span><b className="text-blue-700">{summary.toCreate}</b> new</span>
              {summary.skipped > 0 && <span><b className="text-muted">{summary.skipped}</b> skipped</span>}
              <span className="ml-auto">{rows.length} line{rows.length === 1 ? "" : "s"}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {rows.length === 0 && (
                <p className="text-xs text-muted text-center py-6">No lines parsed.</p>
              )}
              {rows.map((row, i) => (
                <RowEditor key={i}
                  row={row}
                  clubName={clubName}
                  clubMemberIds={clubMemberIds}
                  selectedIds={selectedIds}
                  onChange={(next) => setRows((rs) => rs.map((r, j) => (j === i ? next : r)))}
                />
              ))}
            </div>
            {progress && (
              <div className="px-4 py-2 border-t border-border text-xs">
                Applying… {progress.done} / {progress.total}
              </div>
            )}
            {errors.length > 0 && (
              <div className="px-4 py-2 border-t border-border bg-red-50 text-xs text-red-800 space-y-0.5 max-h-24 overflow-y-auto">
                {errors.map((e, i) => (<div key={i}><b>{e.name}:</b> {e.error}</div>))}
              </div>
            )}
            <div className="flex gap-2 justify-end px-4 py-3 border-t border-border">
              <button type="button" onClick={() => setStep("input")}
                disabled={applying}
                className="bg-gray-100 text-foreground py-2 px-4 rounded-lg text-sm font-medium disabled:opacity-50">
                Back
              </button>
              <button type="button" onClick={apply}
                disabled={applying || (summary.toAdd === 0 && summary.toCreate === 0)}
                className="bg-selected text-white py-2 px-4 rounded-lg text-sm font-medium disabled:opacity-50">
                {applying ? "Applying…" : `Add ${summary.toAdd + summary.toCreate}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface RowEditorProps {
  row: RowState;
  clubName?: string;
  clubMemberIds?: Set<string>;
  selectedIds: Set<string>;
  onChange: (next: RowState) => void;
}

function RowEditor({ row, clubName, clubMemberIds, selectedIds, onChange }: RowEditorProps) {
  const { result } = row;
  const isCreate = row.decision.kind === "create";
  const isSkip = row.decision.kind === "skip";
  const isAddExisting = row.decision.kind === "addExisting";

  const statusBadge = (() => {
    if (isSkip) return <span className="text-[10px] uppercase tracking-wider text-muted">Skip</span>;
    if (isCreate) return <span className="text-[10px] uppercase tracking-wider text-blue-700">New</span>;
    return <span className="text-[10px] uppercase tracking-wider text-green-700">Existing</span>;
  })();

  return (
    <div className="border border-border rounded-lg p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium truncate flex-1">{result.line.name}</span>
        {statusBadge}
      </div>

      {result.status === "exact" && row.decision.kind === "addExisting" && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <PlayerAvatar name={result.candidates[0].name} photoUrl={result.candidates[0].photoUrl} size="xs" />
          <span>→ {result.candidates[0].name}</span>
          {selectedIds.has(result.candidates[0].id) && (
            <span className="text-[10px] text-muted">(already in roster)</span>
          )}
        </div>
      )}

      {result.status === "ambiguous" && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted">{result.candidates.length} possible matches:</p>
          {result.candidates.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="radio"
                checked={row.chosenCandidate === c.id}
                onChange={() => onChange({ ...row, chosenCandidate: c.id, decision: selectedIds.has(c.id) ? { kind: "skip" } : { kind: "addExisting", playerId: c.id } })}
              />
              <PlayerAvatar name={c.name} photoUrl={c.photoUrl} size="xs" />
              <span>{c.name}</span>
              {clubMemberIds?.has(c.id) && (
                <span className="text-[9px] uppercase tracking-wider bg-gray-900 text-white px-1 py-0.5 rounded">club</span>
              )}
              {selectedIds.has(c.id) && <span className="text-[10px] text-muted">(already in roster)</span>}
            </label>
          ))}
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="radio"
              checked={row.chosenCandidate === "__new__"}
              onChange={() => onChange({ ...row, chosenCandidate: "__new__", decision: { kind: "create", name: row.createName, gender: row.createGender, joinClub: row.createJoinClub } })}
            />
            <span>Create new “{row.createName}”</span>
          </label>
        </div>
      )}

      {isCreate && (
        <div className="space-y-1.5 pt-1">
          <div className="flex gap-1.5 items-center">
            <input
              value={row.createName}
              onChange={(e) => onChange({ ...row, createName: e.target.value, decision: { kind: "create", name: e.target.value, gender: row.createGender, joinClub: row.createJoinClub } })}
              className="flex-1 border border-border rounded px-2 py-1 text-xs"
              placeholder="Name"
            />
            <div className="flex gap-1">
              {(["M", "F"] as const).map((g) => (
                <button key={g} type="button"
                  onClick={() => onChange({ ...row, createGender: row.createGender === g ? null : g, decision: { kind: "create", name: row.createName, gender: row.createGender === g ? null : g, joinClub: row.createJoinClub } })}
                  className={`px-2 py-1 rounded text-[10px] font-medium ${
                    row.createGender === g ? (g === "M" ? "bg-blue-500 text-white" : "bg-pink-500 text-white") : "bg-gray-100 text-foreground"
                  }`}>
                  {g === "M" ? "♂" : "♀"}
                </button>
              ))}
            </div>
          </div>
          {clubName && (
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input type="checkbox"
                checked={row.createJoinClub}
                onChange={(e) => onChange({ ...row, createJoinClub: e.target.checked, decision: { kind: "create", name: row.createName, gender: row.createGender, joinClub: e.target.checked } })}
              />
              Also add to {clubName}
            </label>
          )}
        </div>
      )}

      {!isCreate && !isSkip && !isAddExisting && (
        <span className="text-[11px] text-muted italic">No action</span>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {!isSkip && (
          <button type="button" onClick={() => onChange({ ...row, decision: { kind: "skip" } })}
            className="text-[10px] text-muted underline">Skip</button>
        )}
        {isSkip && result.status === "exact" && !selectedIds.has(result.candidates[0].id) && (
          <button type="button" onClick={() => onChange({ ...row, decision: { kind: "addExisting", playerId: result.candidates[0].id } })}
            className="text-[10px] text-action underline">Add</button>
        )}
        {isSkip && result.status === "new" && (
          <button type="button" onClick={() => onChange({ ...row, decision: { kind: "create", name: row.createName, gender: row.createGender, joinClub: row.createJoinClub } })}
            className="text-[10px] text-action underline">Create</button>
        )}
      </div>
    </div>
  );
}
