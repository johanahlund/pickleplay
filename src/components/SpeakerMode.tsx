"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface SpeakerModeProps {
  eventId: string;
  userId: string;
  userName: string;
  isManager: boolean;
}

/**
 * Speak an announcement with proper pacing for outdoor environments.
 * Segments text by ". " or " | " delimiters and adds pauses between.
 * Uses slower rate for clarity.
 */
let pendingTimeouts: ReturnType<typeof setTimeout>[] = [];

export function stopAnnouncement() {
  pendingTimeouts.forEach(clearTimeout);
  pendingTimeouts = [];
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

function speakAnnouncement(text: string) {
  if (!("speechSynthesis" in window)) return;
  stopAnnouncement();

  // Play attention ding via AudioContext
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.stop(ctx.currentTime + 0.5);
  } catch {}

  // Split into segments and speak with pauses
  const segments = text.split(/\.\s*|\s*\|\s*/).filter(Boolean);

  let delay = 600; // initial delay after ding
  for (const segment of segments) {
    const t = setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(segment);
      utterance.rate = 0.85;
      utterance.pitch = 1.0;
      utterance.lang = "en-US";
      speechSynthesis.speak(utterance);
    }, delay);
    pendingTimeouts.push(t);
    // Estimate segment duration + 400ms pause
    delay += segment.length * 60 + 400;
  }
}

export function SpeakerMode({ eventId, userId, userName, isManager }: SpeakerModeProps) {
  const [speakerUserId, setSpeakerUserId] = useState<string | null>(null);
  const [speakerUserName, setSpeakerUserName] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [dimmed, setDimmed] = useState(false);
  const dimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch speaker status
  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/speaker`);
      if (!r.ok) return;
      const data = await r.json();
      setSpeakerUserId(data.speakerUserId);
      setSpeakerUserName(data.speakerUserName);

      // If this device is the speaker and there's a pending announcement
      if (data.speakerUserId === userId && data.pendingAnnouncement) {
        speakAnnouncement(data.pendingAnnouncement);
        // Acknowledge
        fetch(`/api/events/${eventId}/speaker`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ack" }),
        });
        // Briefly undim for the announcement
        setDimmed(false);
        resetDimTimer();
      }
    } catch {}
  }, [eventId, userId]);

  // Initial fetch
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Check if this device is the host
  useEffect(() => {
    setIsHost(speakerUserId === userId);
  }, [speakerUserId, userId]);

  // Polling when host
  useEffect(() => {
    if (!isHost) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(fetchStatus, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isHost, fetchStatus]);

  // Wake Lock when host
  useEffect(() => {
    if (!isHost) {
      wakeLock.current?.release();
      return;
    }
    const requestWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLock.current = await navigator.wakeLock.request("screen");
        }
      } catch {}
    };
    requestWakeLock();

    // Re-acquire on visibility change
    const handleVisibility = () => {
      if (document.visibilityState === "visible") requestWakeLock();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      wakeLock.current?.release();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isHost]);

  // Dim timer
  const resetDimTimer = useCallback(() => {
    if (dimTimer.current) clearTimeout(dimTimer.current);
    dimTimer.current = setTimeout(() => {
      if (isHost) setDimmed(true);
    }, 15000);
  }, [isHost]);

  useEffect(() => {
    if (isHost) resetDimTimer();
    return () => { if (dimTimer.current) clearTimeout(dimTimer.current); };
  }, [isHost, resetDimTimer]);

  const handleSetSpeaker = async () => {
    await fetch(`/api/events/${eventId}/speaker`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_speaker" }),
    });
    await fetchStatus();
  };

  const handleClearSpeaker = async () => {
    await fetch(`/api/events/${eventId}/speaker`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear_speaker" }),
    });
    setDimmed(false);
    await fetchStatus();
  };

  const handleTapDimmed = () => {
    setDimmed(false);
    resetDimTimer();
  };

  // Dim overlay when host
  if (isHost && dimmed) {
    return (
      <div
        className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center cursor-pointer"
        onClick={handleTapDimmed}
      >
        <div className="text-center space-y-3">
          <div className="text-4xl">🔊</div>
          <p className="text-white/40 text-sm">Speaker mode active</p>
          <p className="text-white/20 text-xs">Tap to wake</p>
        </div>
      </div>
    );
  }

  // Non-manager: just show who the speaker is
  if (!isManager) {
    if (!speakerUserId) return null;
    return (
      <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 text-xs text-muted">
        <span>🔊</span>
        <span>Speaker: {speakerUserName}</span>
      </div>
    );
  }

  // Manager view — compact one-line
  return (
    <div className="flex items-center gap-2 bg-card rounded-xl border border-border px-3 py-2">
      <span className="text-lg">🔊</span>
      <span className="text-xs text-muted flex-1">
        {speakerUserId
          ? isHost
            ? "This device"
            : speakerUserName
          : "No speaker"}
      </span>
      {isHost && (
        <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium animate-pulse">Live</span>
      )}
      {!speakerUserId ? (
        <button onClick={handleSetSpeaker}
          className="text-xs font-medium text-action hover:underline shrink-0">
          This device
        </button>
      ) : isHost ? (
        <button onClick={handleClearSpeaker}
          className="text-xs font-medium text-danger hover:underline shrink-0">
          Stop
        </button>
      ) : (
        <button onClick={handleSetSpeaker}
          className="text-xs font-medium text-action hover:underline shrink-0">
          Switch here
        </button>
      )}
    </div>
  );
}

/**
 * Send an announcement to the speaker device.
 * Also plays locally on the triggering device.
 */
/**
 * Format a match announcement with proper structure and pauses.
 * Uses ". " as segment delimiter for the TTS engine.
 */
export function formatMatchAnnouncement(
  courtNum: number,
  team1Names: string[],
  team2Names: string[],
  isKingCourt?: boolean
): string {
  const courtLabel = isKingCourt && courtNum === 1 ? "King Court" : `Court ${courtNum}`;
  const t1 = team1Names.join(" and ");
  const t2 = team2Names.join(" and ");
  return `Attention please. Next match. ${courtLabel}. ${t1}. versus. ${t2}.`;
}

/**
 * Send an announcement to the speaker device.
 * Also plays locally on the triggering device.
 */
export async function sendAnnouncement(eventId: string, text: string) {
  // Play locally
  speakAnnouncement(text);

  // Send to speaker device
  await fetch(`/api/events/${eventId}/speaker`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "announce", text }),
  });
}
