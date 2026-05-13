"use client";

/**
 * ShareSheet — bottom-sheet for "copy invite to WhatsApp" flows.
 *
 * Two-section layout:
 *  1. GROUP MESSAGE — one block to paste into existing WA groups
 *     (covers existing users + cold prospects).
 *  2. UNCLAIMED PLAYERS — per-recipient rows with personalized
 *     claim-link messages. Each row has Copy + (if phone known)
 *     WhatsApp deep-link buttons. The token for each personal link is
 *     fetched lazily on the first Copy/WA click via the existing
 *     `/api/players/[id]/invite` endpoint.
 *
 * The parent provides the GROUP message text and a `buildPersonal()`
 * callback that takes a recipient + their claim URL and returns the
 * personalized text — so the sheet stays scenario-agnostic.
 */

import { useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { personalClaimUrl } from "@/lib/inviteShare";

export interface ShareRecipient {
  id: string;            // playerId
  name: string;
  phone?: string | null;
  hasAccount: boolean;   // claimed (has password)
  /** Optional: a brief label shown to the right of the name
   *  (e.g. team name, role). Pure UX hint, doesn't affect logic. */
  hint?: string | null;
}

interface ShareSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Short paragraph shown above the group-message block to remind the
   *  admin what this share does. */
  blurb?: string;
  /** The group-message text to copy. */
  groupMessage: string;
  /** All eligible recipients (claimed + unclaimed). The sheet defaults
   *  to showing unclaimed only, with a "show all" toggle. */
  recipients: ShareRecipient[];
  /** Build the personal message for an unclaimed recipient, given
   *  their resolved claim URL. */
  buildPersonal: (recipient: ShareRecipient, claimUrl: string) => string;
}

export function ShareSheet({
  open,
  onClose,
  title,
  blurb,
  groupMessage,
  recipients,
  buildPersonal,
}: ShareSheetProps) {
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  // Recipients that have been copied at least once. Persists for the
  // life of the sheet so the admin can track who they've already
  // invited. Tapping the same row again toggles it back to "Copy".
  const [copiedIds, setCopiedIds] = useState<Set<string>>(new Set());
  // Short flash for the group-message Copy button (1.5s revert).
  const [groupFlashed, setGroupFlashed] = useState(false);
  const [errorByRecipient, setErrorByRecipient] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);

  // Reset transient state whenever the sheet re-opens so a stale
  // "copied" check from a previous session doesn't linger.
  useEffect(() => {
    if (open) {
      setCopiedIds(new Set());
      setGroupFlashed(false);
      setErrorByRecipient({});
    }
  }, [open]);

  if (!open) return null;

  const unclaimed = recipients.filter((r) => !r.hasAccount);
  const claimed = recipients.filter((r) => r.hasAccount);
  const visible = showAll ? recipients : unclaimed;

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const flashGroup = () => {
    setGroupFlashed(true);
    setTimeout(() => setGroupFlashed(false), 1500);
  };
  const toggleCopiedId = (id: string, add: boolean) => {
    setCopiedIds((prev) => {
      const next = new Set(prev);
      if (add) next.add(id); else next.delete(id);
      return next;
    });
  };

  const ensureToken = async (r: ShareRecipient): Promise<string | null> => {
    if (tokens[r.id]) return tokens[r.id];
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/players/${r.id}/invite`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.token) {
        setErrorByRecipient((prev) => ({ ...prev, [r.id]: data?.error || "Failed to generate link" }));
        return null;
      }
      setTokens((prev) => ({ ...prev, [r.id]: data.token }));
      return data.token as string;
    } finally {
      setBusyId(null);
    }
  };

  const onCopyGroup = async () => {
    const ok = await copyText(groupMessage);
    if (ok) flashGroup();
  };

  const buildMessageFor = async (r: ShareRecipient): Promise<string | null> => {
    if (r.hasAccount) {
      // Claimed user: send the same group message (it has the event
      // URL, which their app handles natively).
      return groupMessage;
    }
    const token = await ensureToken(r);
    if (!token) return null;
    const claimUrl = personalClaimUrl(origin, token, r.name);
    return buildPersonal(r, claimUrl);
  };

  // First tap copies the personalised message AND marks the row as
  // "copied" (visible ✓). Second tap on the same row toggles back to
  // "Copy" without re-copying — useful when the admin wants to clear a
  // false-positive without resending. Matches the user's mental model of
  // a check-list of "who I've invited so far".
  const onCopyRecipient = async (r: ShareRecipient) => {
    if (copiedIds.has(r.id)) {
      toggleCopiedId(r.id, false);
      return;
    }
    const msg = await buildMessageFor(r);
    if (!msg) return;
    const ok = await copyText(msg);
    if (ok) toggleCopiedId(r.id, true);
  };

  const onWhatsAppRecipient = async (r: ShareRecipient) => {
    if (!r.phone) return;
    const msg = await buildMessageFor(r);
    if (!msg) return;
    const cleanPhone = r.phone.replace(/\D/g, "");
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener");
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-md rounded-t-2xl max-h-[88vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 pt-3 pb-2 border-b border-border flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="text-base font-bold">{title}</h3>
          <button onClick={onClose} className="text-muted text-sm px-2">Done</button>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-4">
          {blurb && <p className="text-xs text-muted">{blurb}</p>}

          {/* Group message section */}
          <section className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-muted font-bold">
              Group message
            </div>
            <pre className="bg-gray-50 border border-border rounded-lg p-2.5 text-[12px] whitespace-pre-wrap font-sans leading-snug max-h-48 overflow-y-auto">{groupMessage}</pre>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCopyGroup}
                className={`text-sm font-semibold px-3 py-1.5 rounded-lg ${groupFlashed ? "bg-emerald-600 text-white" : "bg-action text-white"}`}
              >
                {groupFlashed ? "✓ Copied" : "Copy"}
              </button>
              <span className="text-[11px] text-muted">Paste into your WhatsApp group(s).</span>
            </div>
          </section>

          {/* Unclaimed players section */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-wider text-muted font-bold">
                Reach unclaimed players
              </div>
              {claimed.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="text-[11px] text-muted hover:text-foreground"
                >{showAll ? "Hide claimed" : `+ Show ${claimed.length} claimed`}</button>
              )}
            </div>
            {recipients.length === 0 ? (
              <p className="text-[12px] text-muted italic">No recipients found.</p>
            ) : unclaimed.length === 0 && !showAll ? (
              <p className="text-[12px] text-muted italic">
                Everyone has an account already — paste the group message into your channel above.
              </p>
            ) : (
              <ul className="space-y-1">
                {visible.map((r) => {
                  const isBusy = busyId === r.id;
                  const isCopied = copiedIds.has(r.id);
                  const err = errorByRecipient[r.id];
                  return (
                    <li key={r.id} className="border border-border rounded-lg px-2.5 py-2 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                          <span>{r.name}</span>
                          {r.hasAccount && (
                            <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0">✓ claimed</span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted truncate">
                          {r.hint && <span>{r.hint}</span>}
                          {r.hint && r.phone && <span> · </span>}
                          {r.phone && <span>☎ {r.phone}</span>}
                          {!r.hint && !r.phone && <span className="italic">no phone on file</span>}
                        </div>
                        {err && <div className="text-[11px] text-rose-700 mt-0.5">{err}</div>}
                      </div>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onCopyRecipient(r)}
                        title={isCopied ? "Copied — tap again to mark as not invited" : "Copy personalised invite"}
                        className={`text-[12px] font-semibold px-2.5 py-1 rounded-lg shrink-0 ${isCopied ? "bg-emerald-600 text-white" : "bg-action text-white"} disabled:opacity-50`}
                      >{isBusy ? "…" : isCopied ? "✓ Copied" : "Copy"}</button>
                      {r.phone && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onWhatsAppRecipient(r)}
                          title="Open WhatsApp chat with pre-filled message"
                          className="text-[12px] font-semibold px-2.5 py-1 rounded-lg shrink-0 border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        >WA</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
