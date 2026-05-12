"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typing for the Web Speech API — not in the standard DOM lib.
// We use `unknown` and narrow inside handlers; the surface we touch is
// tiny so this beats pulling in a heavy types package.
interface WindowWithSpeech {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ParsedAssistantMessage {
  headline: string;
  sections: { heading: string; body: string }[];
}

// Split an assistant reply into a plain "headline" paragraph plus any
// `## Section` blocks (level-2 markdown headers). Everything before the
// first header line is the headline; each subsequent header starts a
// new collapsible section.
function parseAssistantMessage(content: string): ParsedAssistantMessage {
  const lines = content.split("\n");
  const headlineLines: string[] = [];
  const sections: { heading: string; body: string }[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i]!)) break;
    headlineLines.push(lines[i]!);
  }
  while (i < lines.length) {
    const headerMatch = lines[i]!.match(/^##\s+(.+?)\s*$/);
    if (!headerMatch) { i++; continue; }
    const heading = headerMatch[1]!;
    i++;
    const bodyLines: string[] = [];
    for (; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i]!)) break;
      bodyLines.push(lines[i]!);
    }
    sections.push({ heading, body: bodyLines.join("\n").trim() });
  }
  return { headline: headlineLines.join("\n").trim(), sections };
}

interface Props {
  open: boolean;
  onClose: () => void;
  leagueId: string;
  leagueName: string;
}

const SUGGESTED = [
  "How do playoffs work?",
  "What are the eligibility rules for the final?",
  "How is the team ranking calculated?",
];

/**
 * Bottom-sheet chat over the league's PDF documents.
 *
 * Slides up from the bottom on open; backdrop above; drag handle at top.
 * Streams replies from POST /api/leagues/[id]/ask via Server-Sent Events.
 * Conversation is in-memory only — closing the sheet clears it.
 */
export function RulesChatSheet({ open, onClose, leagueId, leagueName }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keyed by `${messageIndex}:${sectionIndex}` — present in the set
  // means that section is expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Generated fresh each time the sheet opens; groups Q&A rows from the
  // same chat session for the assistant-logs viewer.
  const [conversationId, setConversationId] = useState<string>("");
  // Voice input via Web Speech API. `listening` drives the mic button
  // state; baseInputRef holds the user's pre-existing typed text so
  // we can append (not overwrite) the recognized transcript.
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseInputRef = useRef<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const speechSupported =
    typeof window !== "undefined" &&
    !!((window as unknown as WindowWithSpeech).SpeechRecognition ||
       (window as unknown as WindowWithSpeech).webkitSpeechRecognition);

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current;
    // Update UI state synchronously so the mic button reverts even on
    // Safari, where onend can be delayed until the current utterance
    // finalizes. Detach handlers so any late callbacks don't fight
    // the new state (e.g. if the user starts a new session quickly).
    setListening(false);
    if (!rec) return;
    rec.onresult = null;
    rec.onend = null;
    rec.onerror = null;
    recognitionRef.current = null;
    // abort() discards in-flight results immediately. stop() merely
    // finalizes the current utterance — too gentle for "tap to stop".
    // Some implementations only ship one of the two, so try both.
    try { rec.abort?.(); } catch { /* ignore */ }
    try { rec.stop(); } catch { /* ignore */ }
  }, []);

  // Conversation persists across close/reopen of the sheet — the user
  // can dismiss the chat and come back to the same thread. We only
  // mint a conversationId on first open, and abort any in-flight
  // request (dropping the empty assistant placeholder) on close so a
  // half-streamed reply doesn't show as a blank bubble next time.
  useEffect(() => {
    if (open) {
      setConversationId((cid) => cid || crypto.randomUUID());
    } else {
      abortRef.current?.abort();
      abortRef.current = null;
      setStreaming(false);
      setMessages((prev) => {
        if (prev.length && prev[prev.length - 1]!.role === "assistant" && prev[prev.length - 1]!.content === "") {
          return prev.slice(0, -1);
        }
        return prev;
      });
    }
  }, [open]);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Autoscroll to bottom on new content, and also when the sheet is
  // reopened (so a returning user lands at the latest turn).
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, messages, streaming]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setError(null);
    setInput("");

    const next: Message[] = [...messages, { role: "user", content: trimmed }, { role: "assistant", content: "" }];
    setMessages(next);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch(`/api/leagues/${leagueId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(0, -1), conversationId }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE: events separated by \n\n
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          let eventName = "message";
          let dataLine = "";
          for (const line of raw.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
          }
          if (!dataLine) continue;
          let payload: unknown;
          try { payload = JSON.parse(dataLine); } catch { continue; }

          if (eventName === "delta") {
            const txt = (payload as { text?: string }).text || "";
            setMessages((prev) => {
              const copy = prev.slice();
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") {
                copy[copy.length - 1] = { ...last, content: last.content + txt };
              }
              return copy;
            });
          } else if (eventName === "error") {
            const msg = (payload as { message?: string }).message || "Unknown error";
            throw new Error(msg);
          }
          // "done" event ignored — stream end implies completion.
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const raw = e instanceof Error ? e.message : "Request failed";
      // Safari's generic fetch failure is "Load failed"; Chrome's is
      // "Failed to fetch". Translate both into something actionable.
      const friendly = /load failed|failed to fetch|networkerror/i.test(raw)
        ? "Connection lost. The server may be slow or restarting — please try again."
        : raw;
      setError(friendly);
      // Drop the empty assistant placeholder.
      setMessages((prev) => {
        const copy = prev.slice();
        if (copy.length && copy[copy.length - 1]!.role === "assistant" && copy[copy.length - 1]!.content === "") {
          copy.pop();
        }
        return copy;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [leagueId, messages, streaming, conversationId]);

  const startListening = useCallback(() => {
    if (!speechSupported || listening || streaming) return;
    const w = window as unknown as WindowWithSpeech;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
    // Capture existing typed text so dictated words append, not overwrite.
    baseInputRef.current = input.trim();
    rec.onresult = (event) => {
      let interim = "";
      let newFinal = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) newFinal += transcript;
        else interim += transcript;
      }
      if (newFinal) {
        const sep = baseInputRef.current ? " " : "";
        baseInputRef.current = (baseInputRef.current + sep + newFinal.trim()).trim();
      }
      const sep = baseInputRef.current && interim ? " " : "";
      setInput((baseInputRef.current + sep + interim.trim()).trim());
    };
    rec.onend = () => { setListening(false); recognitionRef.current = null; };
    rec.onerror = () => { setListening(false); recognitionRef.current = null; };
    try {
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [speechSupported, listening, streaming, input]);

  // Stop recognition when the sheet closes or the component unmounts.
  useEffect(() => {
    if (!open) stopListening();
  }, [open, stopListening]);
  useEffect(() => () => { stopListening(); }, [stopListening]);

  if (!open) return null;

  const isEmpty = messages.length === 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 animate-in fade-in"
      />

      {/* Sheet */}
      <div
        className="relative w-full max-w-[600px] bg-white rounded-t-2xl shadow-2xl flex flex-col"
        style={{ height: "min(75vh, 720px)", animation: "slide-up 0.25s ease-out" }}
      >
        <style>{`
          @keyframes slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
        `}</style>

        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* Header */}
        <div className="px-4 pb-2 flex items-start gap-3 border-b border-border">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold leading-tight">jabberBrain League Assistant</h2>
            <p className="text-[11px] text-muted truncate">{leagueName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded-full hover:bg-gray-100 flex items-center justify-center text-muted"
          >
            ✕
          </button>
        </div>

        {/* Conversation */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {isEmpty && (
            <div className="space-y-3">
              <p className="text-xs text-muted">
                Ask any question about this league&apos;s rules and regulations. You can ask in any language — the assistant will reply in the same language.
              </p>
              <div className="space-y-1.5">
                {SUGGESTED.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => send(q)}
                    className="w-full text-left px-3 py-2 rounded-lg border border-border text-sm hover:bg-gray-50"
                  >
                    💭 {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => {
            if (m.role === "user") {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm bg-action text-white text-sm whitespace-pre-wrap break-words">
                    {m.content}
                  </div>
                </div>
              );
            }
            const isLast = i === messages.length - 1;
            const showPlaceholder = streaming && isLast && m.content === "";
            if (showPlaceholder) {
              return (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-bl-sm bg-gray-100 text-foreground text-sm">…</div>
                </div>
              );
            }
            const { headline, sections } = parseAssistantMessage(m.content);
            return (
              <div key={i} className="flex justify-start">
                <div className="max-w-[85%] space-y-1.5">
                  {headline && (
                    <div className="px-3 py-2 rounded-2xl rounded-bl-sm bg-gray-100 text-foreground text-sm whitespace-pre-wrap break-words">
                      {headline}
                    </div>
                  )}
                  {sections.map((s, si) => {
                    const key = `${i}:${si}`;
                    const isOpen = expanded.has(key);
                    return (
                      <div key={si} className="rounded-xl border border-border bg-white overflow-hidden">
                        <button
                          type="button"
                          onClick={() => {
                            setExpanded((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key); else next.add(key);
                              return next;
                            });
                          }}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-gray-50"
                        >
                          <span className="text-xs font-medium text-foreground truncate">{s.heading}</span>
                          <span className={`text-muted text-xs transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
                        </button>
                        {isOpen && (
                          <div className="px-3 pb-2 text-xs text-foreground whitespace-pre-wrap break-words">
                            {s.body}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 text-danger text-xs">
              {error}
            </div>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="px-3 py-2 border-t border-border flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                stopListening();
                send(input);
              }
            }}
            placeholder={listening ? "Listening… tap mic to stop" : "Ask a question in any language…"}
            rows={1}
            disabled={streaming}
            className="flex-1 resize-none border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-action max-h-32"
          />
          {speechSupported && (
            <button
              type="button"
              onClick={() => (listening ? stopListening() : startListening())}
              disabled={streaming}
              aria-label={listening ? "Stop voice input" : "Start voice input"}
              title={listening ? "Stop voice input" : "Voice input"}
              className={`shrink-0 w-10 h-[38px] rounded-xl flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                listening ? "bg-red-500 text-white animate-pulse" : "bg-gray-100 text-foreground hover:bg-gray-200"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="2" width="6" height="11" rx="3" />
                <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </button>
          )}
          <button
            type="submit"
            disabled={!input.trim() || streaming}
            className="shrink-0 px-3 py-2 rounded-xl bg-action text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {streaming ? "…" : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}
