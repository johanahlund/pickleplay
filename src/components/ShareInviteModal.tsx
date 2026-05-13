"use client";

import { useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { WhatsAppIcon } from "./WhatsAppIcon";

interface Props {
  open: boolean;
  /** The full message to share. Should already include the URL and any
   * install / "Add to Home Screen" tip. */
  message: string;
  /** Optional phone number (any common format). If present, WhatsApp
   * deep-links straight to that contact; otherwise it opens with the
   * contact picker so the user chooses. */
  phone?: string | null;
  /** Title shown at the top of the modal. Defaults to "Share invite". */
  title?: string;
  /** Optional email subject for the Email action. */
  emailSubject?: string;
  onClose: () => void;
}

// Strip everything except digits. WhatsApp's wa.me deep-link wants
// "country code + number", no plus, no spaces, no parens.
function sanitizePhone(p?: string | null): string {
  if (!p) return "";
  return p.replace(/[^\d]/g, "");
}

/**
 * Action chooser for sharing an invite. Replaces `navigator.share` —
 * the native share sheet doesn't always include WhatsApp (notably on
 * macOS), so we present an explicit three-way choice that works
 * uniformly on every platform.
 */
export function ShareInviteModal({ open, message, phone, title = "Share invite", emailSubject = "FriendlyBall invite", onClose }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const phoneDigits = sanitizePhone(phone);
  const encoded = encodeURIComponent(message);
  const whatsappUrl = phoneDigits ? `https://wa.me/${phoneDigits}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
  const mailUrl = `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encoded}`;

  const handleCopy = async () => {
    const ok = await copyText(message);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center px-4 py-4" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-xl p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 className="text-base font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-7 h-7 rounded-full hover:bg-gray-100 flex items-center justify-center text-muted">✕</button>
        </div>

        <div className="mb-3 max-h-32 overflow-y-auto rounded-lg bg-gray-50 border border-border p-2 text-[11px] text-foreground whitespace-pre-wrap break-words">
          {message}
        </div>

        <div className="space-y-2">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setTimeout(onClose, 200)}
            className="flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-xl bg-[#25D366] text-white text-sm font-semibold active:opacity-90"
          >
            <WhatsAppIcon className="w-4 h-4 [&_path]:fill-white" />
            <span>WhatsApp{phoneDigits ? "" : " — pick contact"}</span>
          </a>
          <button
            type="button"
            onClick={handleCopy}
            className={`flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              copied
                ? "bg-emerald-500 text-white"
                : "bg-sky-100 text-sky-800 hover:bg-sky-200 active:bg-sky-300"
            }`}
            aria-label="Copy invite text to clipboard"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span>{copied ? "Copied — paste anywhere" : "Copy invite text"}</span>
          </button>
          <a
            href={mailUrl}
            onClick={() => setTimeout(onClose, 200)}
            className="flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-xl bg-slate-700 text-white text-sm font-semibold hover:bg-slate-800 active:bg-slate-900 transition-colors"
            aria-label="Send invite via email"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </svg>
            <span>Send by email</span>
          </a>
        </div>
      </div>
    </div>
  );
}
