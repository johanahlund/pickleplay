"use client";

import { useState, useCallback, useEffect } from "react";
import { PlayerAvatar } from "./PlayerAvatar";

interface RallyPlayer {
  id: string;
  name: string;
  photoUrl?: string | null;
}

interface RallyTrackerProps {
  matchId: string;
  matchStatus: string;
  visible: boolean;
  team1Players: RallyPlayer[];
  team2Players: RallyPlayer[];
  scoringFormat: string; // "1x11", "3x11", "1xR15", etc.
  winBy: string; // "1", "2", "cap15", etc.
  onStartMatch: () => Promise<void>;
  onSubmitScore: (team1Score: number, team2Score: number) => void;
  onScoreChange?: (team1Score: number, team2Score: number, serverId?: string, receiverId?: string) => void;
  onClose: () => void;
}

// Court position for each player
interface CourtState {
  team1Left: RallyPlayer;
  team1Right: RallyPlayer;
  team2Left: RallyPlayer;
  team2Right: RallyPlayer;
}

interface GameState {
  score: [number, number];
  servingTeam: 1 | 2;
  serverNumber: 1 | 2; // only for side-out
  serverId: string;
  court: CourtState;
  isFirstServe: boolean; // game-start exception: only Server 2
}

type Phase = "pick-sides" | "setup-court" | "playing" | "game-over";

function parseFormat(fmt: string): { isRally: boolean; targetScore: number; sets: number } {
  const sets = fmt.startsWith("3") ? 3 : 1;
  const isRally = fmt.includes("R");
  const pts = parseInt(fmt.replace(/^[13]x/, "").replace("R", ""));
  return { isRally, targetScore: pts || 11, sets };
}

function parseWinBy(wb: string): { winByN: number; cap: number | null } {
  if (wb.startsWith("cap")) return { winByN: 2, cap: parseInt(wb.replace("cap", "")) || null };
  return { winByN: parseInt(wb) || 2, cap: null };
}

function getReceiverId(court: CourtState, serverId: string): string {
  // Receiver is diagonally opposite the server
  if (serverId === court.team1Right.id) return court.team2Left.id;
  if (serverId === court.team1Left.id) return court.team2Right.id;
  if (serverId === court.team2Right.id) return court.team1Left.id;
  if (serverId === court.team2Left.id) return court.team1Right.id;
  return "";
}

function getServerSide(court: CourtState, serverId: string): "left" | "right" {
  if (serverId === court.team1Right.id || serverId === court.team2Right.id) return "right";
  return "left";
}

function isGameWon(score: [number, number], target: number, winByN: number, cap: number | null): false | 1 | 2 {
  const [s1, s2] = score;
  const needed = cap ? Math.min(target, cap) : target;
  if (s1 >= needed && s1 - s2 >= winByN) return 1;
  if (s2 >= needed && s2 - s1 >= winByN) return 2;
  // With cap, first to cap wins
  if (cap && s1 >= cap) return 1;
  if (cap && s2 >= cap) return 2;
  return false;
}

function isGamePoint(score: [number, number], target: number, winByN: number, cap: number | null): boolean {
  const [s1, s2] = score;
  // Check if either team is one point from winning
  return (
    isGameWon([s1 + 1, s2], target, winByN, cap) !== false ||
    isGameWon([s1, s2 + 1], target, winByN, cap) !== false
  );
}

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.9;
  u.pitch = 1;
  window.speechSynthesis.speak(u);
}

function buildAnnouncement(
  state: GameState,
  isRally: boolean,
  targetScore: number,
  winByN: number,
  cap: number | null,
): string {
  const [s1, s2] = state.score;
  const server = findPlayer(state.court, state.serverId);
  const receiverId = getReceiverId(state.court, state.serverId);
  const receiver = findPlayer(state.court, receiverId);
  const side = getServerSide(state.court, state.serverId);

  let text = `${s1} ${s2}`;
  if (!isRally) text += `, Server ${state.serverNumber}`;
  text += `. ${server.name} serves from the ${side} to ${receiver.name}.`;

  if (isGamePoint(state.score, targetScore, winByN, cap)) {
    // Which team has game point?
    if (isGameWon([s1 + 1, s2], targetScore, winByN, cap) === 1) {
      text = `Game point Team A! ` + text;
    } else if (isGameWon([s1, s2 + 1], targetScore, winByN, cap) === 2) {
      text = `Game point Team B! ` + text;
    } else {
      text = `Game point! ` + text;
    }
  }

  return text;
}

function findPlayer(court: CourtState, playerId: string): RallyPlayer {
  if (court.team1Left.id === playerId) return court.team1Left;
  if (court.team1Right.id === playerId) return court.team1Right;
  if (court.team2Left.id === playerId) return court.team2Left;
  if (court.team2Right.id === playerId) return court.team2Right;
  return { id: "", name: "?" };
}

export function RallyTracker({
  matchId,
  matchStatus,
  visible,
  team1Players,
  team2Players,
  scoringFormat,
  winBy,
  onStartMatch,
  onSubmitScore,
  onScoreChange,
  onClose,
}: RallyTrackerProps) {
  const { isRally, targetScore } = parseFormat(scoringFormat);
  const { winByN, cap } = parseWinBy(winBy);
  const isDoubles = team1Players.length === 2 && team2Players.length === 2;

  const [phase, setPhase] = useState<Phase>("pick-sides");
  const [setupServer, setSetupServer] = useState<RallyPlayer | null>(null);
  const [setupReceiver, setSetupReceiver] = useState<RallyPlayer | null>(null);
  // Court order: [top, bottom] for each team — bottom = right court (serving side)
  const [team1Order, setTeam1Order] = useState<RallyPlayer[]>(team1Players);
  const [team2Order, setTeam2Order] = useState<RallyPlayer[]>(team2Players);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [swapped, setSwapped] = useState(false); // swap screen sides for teams

  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedDisplay, setElapsedDisplay] = useState("0:00");
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [initialGameState, setInitialGameState] = useState<GameState | null>(null);
  const [history, setHistory] = useState<GameState[]>([]); // all states, index 0 = after first rally
  const [redoStack, setRedoStack] = useState<{ state: GameState; winner: 1 | 2 | null }[]>([]);
  const [winner, setWinner] = useState<1 | 2 | null>(null);

  // Timer
  useEffect(() => {
    if (!startTime || winner) return;
    const interval = setInterval(() => {
      const secs = Math.floor((Date.now() - startTime) / 1000);
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      setElapsedDisplay(`${m}:${s.toString().padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime, winner]);

  // Format label
  const formatLabel = isRally ? "Rally" : "Side-out";
  const winByLabel = cap ? `cap ${cap}` : `win by ${winByN}`;

  // Step 1: Pick server
  // Ensure the given player is at bottom (right court = serving position)
  const moveToBottom = (player: RallyPlayer) => {
    const inTeam1 = team1Players.some((p) => p.id === player.id);
    if (inTeam1) {
      const partner = team1Players.find((p) => p.id !== player.id);
      if (partner) setTeam1Order([partner, player]);
    } else {
      const partner = team2Players.find((p) => p.id !== player.id);
      if (partner) setTeam2Order([partner, player]);
    }
  };

  // Ensure the given player is at top (left court = receiving diagonal from bottom-right)
  const moveToTop = (player: RallyPlayer) => {
    const inTeam1 = team1Players.some((p) => p.id === player.id);
    if (inTeam1) {
      const partner = team1Players.find((p) => p.id !== player.id);
      if (partner) setTeam1Order([player, partner]);
    } else {
      const partner = team2Players.find((p) => p.id !== player.id);
      if (partner) setTeam2Order([player, partner]);
    }
  };

  // Setup court: tap a player to assign as server, then receiver
  const handleSetupTap = (player: RallyPlayer) => {
    const isTeam1 = team1Players.some((p) => p.id === player.id);

    if (!setupServer) {
      // First tap = server — move to bottom (right court)
      setSetupServer(player);
      setSetupReceiver(null);
      moveToBottom(player);
    } else if (setupServer.id === player.id) {
      // Tap same player = deselect
      setSetupServer(null);
      setSetupReceiver(null);
    } else if (!setupReceiver) {
      // Server picked but no receiver yet
      const serverIsTeam1 = team1Players.some((p) => p.id === setupServer.id);
      const sameTeam = (serverIsTeam1 && isTeam1) || (!serverIsTeam1 && !isTeam1);
      if (!sameTeam && isDoubles) {
        // Other team = receiver — move to top (diagonal from server at bottom)
        setSetupReceiver(player);
        moveToTop(player);
      } else {
        // Same team or singles = switch server to this player
        setSetupServer(player);
        setSetupReceiver(null);
        moveToBottom(player);
      }
    } else {
      // Both server and receiver picked — tap anyone to re-pick as server
      setSetupServer(player);
      setSetupReceiver(null);
      moveToBottom(player);
    }
  };

  const handleSetupConfirm = () => {
    if (!setupServer) return;
    const serverTeam = team1Players.some((p) => p.id === setupServer.id) ? 1 : 2;
    if (!isDoubles) {
      const opponent = serverTeam === 1 ? team2Players[0] : team1Players[0];
      initGame(setupServer, opponent, serverTeam as 1 | 2);
    } else {
      if (!setupReceiver) return;
      initGame(setupServer, setupReceiver, serverTeam as 1 | 2);
    }
  };

  // Initialize game state from server + receiver picks
  const initGame = (server: RallyPlayer, receiver: RallyPlayer, serverTeam: 1 | 2) => {
    // Server is on the RIGHT (game always starts from right)
    // Receiver is DIAGONAL from server, so receiver is on the LEFT of their team
    let court: CourtState;

    if (!isDoubles) {
      // Singles: server starts on right (score 0 = even), receiver diagonal
      court = {
        team1Left: team1Players[0],
        team1Right: team1Players[0],
        team2Left: team2Players[0],
        team2Right: team2Players[0],
      };
    } else {
      const serverPartner = (serverTeam === 1 ? team1Players : team2Players).find((p) => p.id !== server.id)!;
      const receiverTeam = serverTeam === 1 ? 2 : 1;
      const receiverPartner = (receiverTeam === 1 ? team1Players : team2Players).find((p) => p.id !== receiver.id)!;

      if (serverTeam === 1) {
        court = {
          team1Right: server,      // server on right
          team1Left: serverPartner, // partner on left
          team2Left: receiver,      // receiver diagonal from server (left)
          team2Right: receiverPartner,
        };
      } else {
        court = {
          team2Right: server,
          team2Left: serverPartner,
          team1Left: receiver,
          team1Right: receiverPartner,
        };
      }
    }

    const state: GameState = {
      score: [0, 0],
      servingTeam: serverTeam,
      serverNumber: isDoubles ? 2 : 1, // Singles: no Server 1/2 concept
      serverId: server.id,
      court,
      isFirstServe: isDoubles, // Singles: no first-serve exception
    };

    setGameState(state);
    setInitialGameState(state);
    setHistory([]);
    setRedoStack([]);
    setPhase("playing");
    setStartTime(Date.now());

    // Auto-start the match if still pending
    if (matchStatus === "pending") {
      onStartMatch();
    }
  };

  // Handle rally result
  const handleRally = useCallback((winningTeam: 1 | 2) => {
    if (!gameState) return;

    setHistory((prev) => [...prev, { ...gameState, court: { ...gameState.court } }]);
    setRedoStack([]); // new rally clears redo

    const newState = { ...gameState, court: { ...gameState.court } };
    const servingTeam = newState.servingTeam;

    if (isRally) {
      // RALLY SCORING: point on every rally
      if (winningTeam === 1) newState.score = [newState.score[0] + 1, newState.score[1]];
      else newState.score = [newState.score[0], newState.score[1] + 1];

      if (winningTeam !== servingTeam) {
        // Side-out: other team serves
        newState.servingTeam = winningTeam;
      }

      // Rally: players stay on their sides. Server determined by score parity.
      const teamPlayers = newState.servingTeam === 1 ? team1Players : team2Players;
      const teamScore = newState.score[newState.servingTeam - 1];
      // Even score → right player serves, odd → left player serves
      if (isDoubles) {
        const rightPlayer = newState.servingTeam === 1 ? newState.court.team1Right : newState.court.team2Right;
        const leftPlayer = newState.servingTeam === 1 ? newState.court.team1Left : newState.court.team2Left;
        newState.serverId = (teamScore % 2 === 0) ? rightPlayer.id : leftPlayer.id;
      } else {
        newState.serverId = teamPlayers[0].id;
      }
    } else {
      // SIDE-OUT SCORING
      if (winningTeam === servingTeam) {
        // Serving team wins: +1 point, server switches sides
        if (servingTeam === 1) {
          newState.score = [newState.score[0] + 1, newState.score[1]];
        } else {
          newState.score = [newState.score[0], newState.score[1] + 1];
        }

        if (isDoubles) {
          // Swap serving team's players (left ↔ right)
          if (servingTeam === 1) {
            const tmp = newState.court.team1Left;
            newState.court.team1Left = newState.court.team1Right;
            newState.court.team1Right = tmp;
          } else {
            const tmp = newState.court.team2Left;
            newState.court.team2Left = newState.court.team2Right;
            newState.court.team2Right = tmp;
          }
        }
        // Server stays same person (now on other side)
      } else {
        // Receiving team wins the rally
        if (!isDoubles) {
          // Singles: immediate side-out
          newState.servingTeam = winningTeam;
          newState.serverId = (newState.servingTeam === 1 ? team1Players[0] : team2Players[0]).id;
        } else if (newState.isFirstServe) {
          // Game-start exception: only Server 2, straight to side-out
          newState.servingTeam = winningTeam;
          newState.serverNumber = 1;
          newState.isFirstServe = false;
          // After side-out: serve from RIGHT
          if (isDoubles) {
            newState.serverId = (newState.servingTeam === 1 ? newState.court.team1Right : newState.court.team2Right).id;
          } else {
            newState.serverId = (newState.servingTeam === 1 ? team1Players[0] : team2Players[0]).id;
          }
        } else if (newState.serverNumber === 1) {
          // Server 1 loses → Server 2 takes over from wherever they are
          newState.serverNumber = 2;
          if (isDoubles) {
            // Partner takes over
            const currentServer = newState.serverId;
            const teamPlayers = servingTeam === 1
              ? [newState.court.team1Left, newState.court.team1Right]
              : [newState.court.team2Left, newState.court.team2Right];
            newState.serverId = teamPlayers.find((p) => p.id !== currentServer)!.id;
          }
        } else {
          // Server 2 loses → SIDE-OUT
          newState.servingTeam = winningTeam;
          newState.serverNumber = 1;
          newState.isFirstServe = false;
          // After side-out: serve from RIGHT
          if (isDoubles) {
            newState.serverId = (newState.servingTeam === 1 ? newState.court.team1Right : newState.court.team2Right).id;
          } else {
            newState.serverId = (newState.servingTeam === 1 ? team1Players[0] : team2Players[0]).id;
          }
        }
      }
    }

    // Check for game over
    const w = isGameWon(newState.score, targetScore, winByN, cap);
    if (w) {
      setWinner(w);
      setPhase("game-over");
    }

    setGameState(newState);
    const newReceiverId = getReceiverId(newState.court, newState.serverId);
    onScoreChange?.(newState.score[0], newState.score[1], newState.serverId, newReceiverId);

    // Auto-speak
    if (autoSpeak && !w) {
      setTimeout(() => {
        speak(buildAnnouncement(newState, isRally, targetScore, winByN, cap));
      }, 300);
    }
  }, [gameState, isRally, isDoubles, targetScore, winByN, cap, autoSpeak, team1Players, team2Players]);

  const handleUndo = () => {
    if (history.length === 0 || !gameState) return;
    setRedoStack((prev) => [...prev, { state: { ...gameState, court: { ...gameState.court } }, winner }]);
    const prev = history[history.length - 1];
    setGameState(prev);
    setHistory((h) => h.slice(0, -1));
    if (winner) {
      setWinner(null);
      setPhase("playing");
    }
  };

  const handleRedo = () => {
    if (redoStack.length === 0 || !gameState) return;
    setHistory((prev) => [...prev, { ...gameState, court: { ...gameState.court } }]);
    const next = redoStack[redoStack.length - 1];
    setGameState(next.state);
    setRedoStack((s) => s.slice(0, -1));
    if (next.winner) {
      setWinner(next.winner);
      setPhase("game-over");
    }
  };

  const handleSpeak = () => {
    if (typeof window !== "undefined" && window.speechSynthesis?.speaking) {
      window.speechSynthesis.cancel();
      return;
    }
    if (!gameState) return;
    speak(buildAnnouncement(gameState, isRally, targetScore, winByN, cap));
  };

  const handleSubmit = () => {
    if (!gameState) return;
    onSubmitScore(gameState.score[0], gameState.score[1]);
  };

  if (!visible) return null;

  // ── RENDER: Pick Sides ──
  if (phase === "pick-sides") {
    // Smart short names for all players in the match
    const allPlayers = [...team1Players, ...team2Players];
    const fnCounts = new Map<string, number>();
    for (const p of allPlayers) {
      const fn = p.name.split(" ")[0];
      fnCounts.set(fn, (fnCounts.get(fn) || 0) + 1);
    }
    const sn = (p: RallyPlayer) => {
      const fn = p.name.split(" ")[0];
      return (fnCounts.get(fn) || 0) > 1 ? p.name : fn;
    };
    const team1Names = team1Players.map(sn).join(" and ");

    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col text-white" style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 2rem)" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <button onClick={onClose} className="text-sm text-white/60 hover:text-white transition-colors">← Matches</button>
          <span className="text-sm opacity-60">{formatLabel} · to {targetScore} · {winByLabel}</span>
          <div className="w-16" />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-5">
          <div className="text-base text-white font-medium">Which side is {team1Names} on?</div>
          <div className="w-full max-w-sm" style={{ display: "grid", gridTemplateColumns: "60px 1fr 60px", gap: "0.75rem", alignItems: "center" }}>
            <button onClick={() => { setSwapped(false); setPhase("setup-court"); }}
              className="flex flex-col items-center gap-1 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 border-2 border-blue-400 rounded-xl px-5 py-4 transition-colors shadow-lg shadow-blue-500/30">
              <span className="text-3xl">←</span>
              <span className="text-sm font-bold text-white">Left</span>
            </button>
            <div className="bg-white/5 border border-white/20 rounded-xl px-4 py-3 text-center">
              {team1Players.map((p, i) => (
                <div key={p.id} className="flex flex-col items-center">
                  <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="md" />
                  <div className="text-lg font-bold text-white mt-1">{sn(p)}</div>
                  {i < team1Players.length - 1 && <div className="text-sm text-white/40 my-0.5">&</div>}
                </div>
              ))}
            </div>
            <button onClick={() => { setSwapped(true); setPhase("setup-court"); }}
              className="flex flex-col items-center gap-1 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 border-2 border-blue-400 rounded-xl px-5 py-4 transition-colors shadow-lg shadow-blue-500/30">
              <span className="text-3xl">→</span>
              <span className="text-sm font-bold text-white">Right</span>
            </button>
          </div>

          <div className="text-xs text-white/30">vs</div>

          <div className="w-full max-w-sm">
            <div className="bg-white/5 border border-white/20 rounded-xl px-4 py-3 text-center">
              {team2Players.map((p, i) => (
                <div key={p.id} className="flex flex-col items-center">
                  <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="md" />
                  <div className="text-lg font-bold text-white mt-1">{sn(p)}</div>
                  {i < team2Players.length - 1 && <div className="text-sm text-white/40 my-0.5">&</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER: Setup Court ──
  if (phase === "setup-court") {
    // Determine which team is on left vs right based on swapped
    const leftTeam = swapped ? team2Order : team1Order;
    const rightTeam = swapped ? team1Order : team2Order;
    const leftLabel = swapped ? "Team B" : "Team A";
    const rightLabel = swapped ? "Team A" : "Team B";
    const leftColor = swapped ? "red" : "blue";
    const rightColor = swapped ? "blue" : "red";

    // Instruction text
    const instruction = !setupServer
      ? "Tap the player who serves first"
      : !isDoubles
        ? "Ready! Press Start — or tap another player to change server"
        : !setupReceiver
          ? "Tap receiver (other team) — or tap another to change server"
          : "Ready! Press Start — or tap any player to re-pick";

    const renderSetupPlayer = (player: RallyPlayer, color: string) => {
      const isServer = setupServer?.id === player.id;
      const isReceiver = setupReceiver?.id === player.id;
      return (
        <button key={player.id} onClick={() => handleSetupTap(player)}
          className={`flex-1 flex flex-col items-center justify-center rounded-xl p-3 border-2 transition-all ${
            isServer
              ? "border-green-400 bg-green-500/25"
              : isReceiver
                ? "border-yellow-400 bg-yellow-500/20"
                : `border-${color}-500/30 bg-${color}-900/30 hover:bg-${color}-800/40`
          }`}>
          <PlayerAvatar name={player.name} photoUrl={player.photoUrl} size="md" />
          <span className={`text-base font-bold mt-1 ${isServer ? "text-green-300" : isReceiver ? "text-yellow-300" : "text-white/80"}`}>
            {player.name}
          </span>
          {isServer && <span className="text-[10px] text-green-300 font-medium mt-0.5">SERVER</span>}
          {isReceiver && <span className="text-[10px] text-yellow-300 font-medium mt-0.5">RECEIVER</span>}
        </button>
      );
    };

    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col text-white" style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 2rem)" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <button onClick={() => { setSetupServer(null); setSetupReceiver(null); setPhase("pick-sides"); }} className="text-sm text-white/60 hover:text-white transition-colors">← Matches</button>
          <span className="text-sm opacity-60">{formatLabel} · to {targetScore} · {winByLabel}</span>
          <button onClick={onClose} className="text-white/60 hover:text-white text-lg">✕</button>
        </div>

        {/* Instruction */}
        <div className="text-center py-3">
          <span className={`text-base font-semibold ${setupServer && setupReceiver ? "text-green-400" : "text-white"}`}>{instruction}</span>
        </div>

        {/* Court layout — horizontal */}
        <div className="flex-1 flex p-3 gap-1 min-h-0">
          {/* Left team */}
          <div className="flex-1 flex flex-col gap-2">
            <div className={`text-[10px] text-center uppercase tracking-wider font-medium mb-0.5 text-${leftColor}-300`}>{leftLabel}</div>
            {leftTeam.map((p) => renderSetupPlayer(p, leftColor))}
          </div>

          {/* Net */}
          <div className="flex flex-col items-center justify-center w-6 relative">
            <div className="absolute inset-y-6 w-0.5 bg-white/30 left-1/2 -translate-x-1/2" />
            {setupServer && setupReceiver && (
              <div className="text-green-400/80 font-bold z-10" style={{
                fontSize: "3rem",
                transform: (() => {
                  const serverOnLeft = leftTeam.some((p) => p.id === setupServer.id);
                  const serverIdx = (serverOnLeft ? leftTeam : rightTeam).findIndex((p) => p.id === setupServer.id);
                  const serverIsTop = serverIdx === 0;
                  return serverOnLeft
                    ? (serverIsTop ? "rotate(30deg)" : "rotate(-30deg)")
                    : (serverIsTop ? "rotate(-30deg)" : "rotate(30deg)");
                })(),
              }}>
                {leftTeam.some((p) => p.id === setupServer.id) ? "→" : "←"}
              </div>
            )}
            <span className="text-[8px] text-white/40 uppercase tracking-widest font-bold z-10" style={{ writingMode: "vertical-lr" }}>NET</span>
          </div>

          {/* Right team */}
          <div className="flex-1 flex flex-col gap-2">
            <div className={`text-[10px] text-center uppercase tracking-wider font-medium mb-0.5 text-${rightColor}-300`}>{rightLabel}</div>
            {rightTeam.map((p) => renderSetupPlayer(p, rightColor))}
          </div>
        </div>

        {/* Start button */}
        <div className="p-3 border-t border-white/10">
          <button onClick={handleSetupConfirm}
            disabled={!setupServer || (isDoubles && !setupReceiver)}
            className="w-full bg-green-600 hover:bg-green-500 disabled:bg-white/10 disabled:text-white/30 text-white py-4 rounded-xl text-xl font-bold transition-colors">
            Start Match
          </button>
        </div>
      </div>
    );
  }

  // ── RENDER: Playing / Game Over ──
  if (!gameState) return null;

  const { score, servingTeam, serverId, court } = gameState;
  const receiverId = getReceiverId(court, serverId);
  const serverSide = getServerSide(court, serverId);
  const gamePointActive = isGamePoint(score, targetScore, winByN, cap);

  const renderCourtPlayer = (player: RallyPlayer, position: "t1l" | "t1r" | "t2l" | "t2r") => {
    const isServer = player.id === serverId;
    const isReceiver = player.id === receiverId;
    const team = position.startsWith("t1") ? 1 : 2;
    const teamColor = team === 1 ? "blue" : "red";

    return (
      <div className={`flex-1 flex flex-col items-center justify-center rounded-lg p-1 transition-all ${
        isServer
          ? "border-4 border-green-400 bg-green-500/30 shadow-lg shadow-green-500/20 ring-2 ring-green-400/50"
          : isReceiver
            ? "border-2 border-white/40 bg-white/5"
            : "border border-white/10 bg-white/5"
      }`}>
        <span className={isServer || isReceiver ? "" : "opacity-30"}>
          <PlayerAvatar name={player.name} photoUrl={player.photoUrl} size="xs" />
        </span>
        <span className={`font-bold mt-0.5 ${isServer ? "text-base text-green-300" : isReceiver ? "text-base text-white/80" : "text-base text-white/40"}`}>
          {shortName(player)}
        </span>
        {isServer && <span className="text-[9px] text-green-300 font-bold animate-pulse">● Server</span>}
        {isReceiver && <span className="text-[8px] text-white/40 font-medium">Receiver</span>}
      </div>
    );
  };

  // Smart name: use first name only unless duplicates exist on court
  const allCourtPlayers = [court.team1Left, court.team1Right, court.team2Left, court.team2Right];
  const firstNameCounts = new Map<string, number>();
  for (const p of allCourtPlayers) {
    const first = p.name.split(" ")[0];
    firstNameCounts.set(first, (firstNameCounts.get(first) || 0) + 1);
  }
  const shortName = (p: RallyPlayer) => {
    const first = p.name.split(" ")[0];
    return (firstNameCounts.get(first) || 0) > 1 ? p.name : first;
  };

  const serverPlayer = findPlayer(court, serverId);
  const receiverPlayer = findPlayer(court, receiverId);

  // Derive "what just happened" from history.
  // history[N] = state BEFORE rally N+1.  gameState = state AFTER last rally.
  // Compare last history entry (before) with gameState (after) to see what changed.
  const lastActionText = (() => {
    if (history.length === 0) return "Match Start";

    const before = history[history.length - 1]; // state before the last rally
    const after = gameState; // state after the last rally

    const team1Scored = after.score[0] > before.score[0];
    const team2Scored = after.score[1] > before.score[1];

    if (team1Scored || team2Scored) {
      // Someone scored. In side-out scoring, only the server scores.
      // Name the server from the BEFORE state (they won the rally).
      const beforeServer = findPlayer(before.court, before.serverId);
      if (isRally && (team1Scored ? 1 : 2) !== before.servingTeam) {
        // Rally scoring: non-serving team scored = they won the rally + side out
        return `Point — side out`;
      }
      return `Point to ${shortName(beforeServer)}`;
    }

    // No score change = serving team lost the rally
    if (after.servingTeam !== before.servingTeam) return "Side out";
    if (isDoubles && !isRally && after.serverNumber !== before.serverNumber) return "2nd Server";
    return "Side out";
  })();

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col text-white select-none" style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 2rem)" }}>
      {/* Compact header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10">
        <button onClick={onClose} className="text-sm text-white/50 hover:text-white">← Matches</button>
        <span className="text-[10px] text-white/30">{formatLabel} · to {targetScore} · {history.length} rallies · {elapsedDisplay}</span>
        <button onClick={() => {
          if (confirm("Reset the entire match score?") && confirm("Are you absolutely sure? All points will be lost!")) {
            setPhase("pick-sides"); setGameState(null); setInitialGameState(null); setHistory([]); setRedoStack([]); setWinner(null); setSetupServer(null); setSetupReceiver(null); setStartTime(null); setTeam1Order(team1Players); setTeam2Order(team2Players);
          }
        }} className="text-[10px] text-red-400 hover:text-red-300 font-bold" title="Reset">Reset</button>
      </div>

      {/* Court view — compact, at top */}
      {(() => {
        const leftTop = swapped ? court.team2Left : court.team1Left;
        const leftBot = swapped ? court.team2Right : court.team1Right;
        const leftTPos = swapped ? "t2l" as const : "t1l" as const;
        const leftBPos = swapped ? "t2r" as const : "t1r" as const;
        const rightTop = swapped ? court.team1Left : court.team2Left;
        const rightBot = swapped ? court.team1Right : court.team2Right;
        const rightTPos = swapped ? "t1l" as const : "t2l" as const;
        const rightBPos = swapped ? "t1r" as const : "t2r" as const;

        const serverOnLeft = [leftTop.id, leftBot.id].includes(serverId);
        const serverIsTop = serverId === leftTop.id || serverId === rightTop.id;

        return (
          <div className="flex p-2 gap-1 relative border-2 border-white/30 rounded-xl mx-3 mt-3 mb-4" style={{ height: "26vh" }}>
            {/* Serve arrow — centered on court, angled from server to receiver */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-20">
              <defs>
                <marker id="serve-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
                  <polygon points="0 0, 10 4, 0 8" fill="rgb(74, 222, 128)" />
                </marker>
              </defs>
              <line
                x1={serverOnLeft ? "42%" : "58%"}
                y1={serverIsTop ? "38%" : "62%"}
                x2={serverOnLeft ? "62%" : "38%"}
                y2={serverIsTop ? "62%" : "38%"}
                stroke="rgb(74, 222, 128)"
                strokeWidth="3"
                markerEnd="url(#serve-arrow)"
              />
            </svg>
            {/* Left team */}
            <div className="flex-1 flex flex-col gap-2">
              {isDoubles ? (
                <>{renderCourtPlayer(leftTop, leftTPos)}{renderCourtPlayer(leftBot, leftBPos)}</>
              ) : (
                // Singles: show left and right squares for this player
                (() => {
                  const player = swapped ? team2Players[0] : team1Players[0];
                  const playerScore = swapped ? score[1] : score[0];
                  const isServing = servingTeam === (swapped ? 2 : 1);
                  const serveFromRight = isServing && playerScore % 2 === 0;
                  const serveFromLeft = isServing && playerScore % 2 !== 0;
                  const recvRight = !isServing && (() => { const svrScore = swapped ? score[0] : score[1]; return svrScore % 2 !== 0; })();
                  const recvLeft = !isServing && !recvRight;
                  const leftActive = serveFromLeft || recvLeft;
                  const rightActive = serveFromRight || recvRight;
                  return (
                    <>
                      <div className={`flex-1 flex flex-col items-center justify-center rounded-lg p-1 transition-all ${
                        serveFromLeft ? "border-4 border-green-400 bg-green-500/30 shadow-lg shadow-green-500/20 ring-2 ring-green-400/50"
                        : recvLeft ? "border-2 border-yellow-400/60 bg-yellow-500/10"
                        : "border border-dashed border-white/10 bg-transparent"
                      }`}>
                        {leftActive && <PlayerAvatar name={player.name} photoUrl={player.photoUrl} size="sm" />}
                        <span className={`font-bold mt-0.5 ${serveFromLeft ? "text-lg text-green-300" : recvLeft ? "text-lg text-yellow-200" : "text-sm text-white/20"}`}>{leftActive ? player.name : "Left"}</span>
                        {serveFromLeft && <span className="text-[10px] text-green-300 font-bold animate-pulse">● SRV</span>}
                        {recvLeft && <span className="text-[9px] text-yellow-300/70">RCV</span>}
                      </div>
                      <div className={`flex-1 flex flex-col items-center justify-center rounded-lg p-1 transition-all ${
                        serveFromRight ? "border-4 border-green-400 bg-green-500/30 shadow-lg shadow-green-500/20 ring-2 ring-green-400/50"
                        : recvRight ? "border-2 border-yellow-400/60 bg-yellow-500/10"
                        : "border border-dashed border-white/10 bg-transparent"
                      }`}>
                        {rightActive && <PlayerAvatar name={player.name} photoUrl={player.photoUrl} size="sm" />}
                        <span className={`font-bold mt-0.5 ${serveFromRight ? "text-lg text-green-300" : recvRight ? "text-lg text-yellow-200" : "text-sm text-white/20"}`}>{rightActive ? player.name : "Right"}</span>
                        {serveFromRight && <span className="text-[10px] text-green-300 font-bold animate-pulse">● SRV</span>}
                        {recvRight && <span className="text-[9px] text-yellow-300/70">RCV</span>}
                      </div>
                    </>
                  );
                })()
              )}
            </div>

            {/* Net (vertical) */}
            <div className="flex flex-col items-center justify-center w-8 relative">
              <div className="absolute inset-y-2 w-0.5 bg-white/60 left-1/2 -translate-x-1/2" />
              <button onClick={() => setSwapped(!swapped)} className="text-[8px] text-white/50 uppercase tracking-widest font-bold hover:text-white/80 transition-colors z-10 py-1 bg-black px-0.5" title="Swap sides"
                style={{ writingMode: "vertical-lr" }}>
                ⇄ NET
              </button>
            </div>

            {/* Right team */}
            <div className="flex-1 flex flex-col gap-2">
              {isDoubles ? (
                <>{renderCourtPlayer(rightTop, rightTPos)}{renderCourtPlayer(rightBot, rightBPos)}</>
              ) : (
                (() => {
                  const player = swapped ? team1Players[0] : team2Players[0];
                  const playerScore = swapped ? score[0] : score[1];
                  const isServing = servingTeam === (swapped ? 1 : 2);
                  const serveFromRight = isServing && playerScore % 2 === 0;
                  const serveFromLeft = isServing && playerScore % 2 !== 0;
                  const recvRight = !isServing && (() => { const svrScore = swapped ? score[1] : score[0]; return svrScore % 2 !== 0; })();
                  const recvLeft = !isServing && !recvRight;
                  const leftActive = serveFromLeft || recvLeft;
                  const rightActive = serveFromRight || recvRight;
                  return (
                    <>
                      <div className={`flex-1 flex flex-col items-center justify-center rounded-lg p-1 transition-all ${
                        serveFromLeft ? "border-4 border-green-400 bg-green-500/30 shadow-lg shadow-green-500/20 ring-2 ring-green-400/50"
                        : recvLeft ? "border-2 border-yellow-400/60 bg-yellow-500/10"
                        : "border border-dashed border-white/10 bg-transparent"
                      }`}>
                        {leftActive && <PlayerAvatar name={player.name} photoUrl={player.photoUrl} size="sm" />}
                        <span className={`font-bold mt-0.5 ${serveFromLeft ? "text-lg text-green-300" : recvLeft ? "text-lg text-yellow-200" : "text-sm text-white/20"}`}>{leftActive ? player.name : "Left"}</span>
                        {serveFromLeft && <span className="text-[10px] text-green-300 font-bold animate-pulse">● SRV</span>}
                        {recvLeft && <span className="text-[9px] text-yellow-300/70">RCV</span>}
                      </div>
                      <div className={`flex-1 flex flex-col items-center justify-center rounded-lg p-1 transition-all ${
                        serveFromRight ? "border-4 border-green-400 bg-green-500/30 shadow-lg shadow-green-500/20 ring-2 ring-green-400/50"
                        : recvRight ? "border-2 border-yellow-400/60 bg-yellow-500/10"
                        : "border border-dashed border-white/10 bg-transparent"
                      }`}>
                        {rightActive && <PlayerAvatar name={player.name} photoUrl={player.photoUrl} size="sm" />}
                        <span className={`font-bold mt-0.5 ${serveFromRight ? "text-lg text-green-300" : recvRight ? "text-lg text-yellow-200" : "text-sm text-white/20"}`}>{rightActive ? player.name : "Right"}</span>
                        {serveFromRight && <span className="text-[10px] text-green-300 font-bold animate-pulse">● SRV</span>}
                        {recvRight && <span className="text-[9px] text-yellow-300/70">RCV</span>}
                      </div>
                    </>
                  );
                })()
              )}
            </div>
          </div>
        );
      })()}

      {/* Rally counter — between court and score */}
      <div className="text-center">
        {gamePointActive && !winner ? (
          <span className="text-base font-bold text-yellow-400 animate-pulse">🏆 Game Point!</span>
        ) : (
          <span className="text-xs text-white/40 font-medium">
            {redoStack.length === 0 ? `Rally ${history.length + 1}` : `Rally ${history.length}`}
          </span>
        )}
      </div>

      {/* Score — closer to court */}
      <div className="px-4 pt-1 pb-0">
        {(() => {
          const leftTeamNum = swapped ? 2 : 1;
          const rightTeamNum = swapped ? 1 : 2;
          const leftScore = swapped ? score[1] : score[0];
          const rightScore = swapped ? score[0] : score[1];
          const leftWon = (swapped ? winner === 2 : winner === 1);
          const rightWon = (swapped ? winner === 1 : winner === 2);
          const leftColor = swapped ? "text-red-500" : "text-blue-500";
          const rightColor = swapped ? "text-blue-500" : "text-red-500";
          const servingLeft = servingTeam === leftTeamNum;
          return (
            <div className="flex items-start mx-3">
              <button onClick={handleUndo} disabled={history.length === 0}
                className="text-white/40 hover:text-white disabled:opacity-10 text-2xl px-1 pt-2 transition-colors shrink-0">←</button>
              <div className="flex-1 text-center">
                <span className={`text-5xl font-black tabular-nums ${leftWon ? "text-green-400" : leftColor}`}>{leftScore}</span>
                {!isRally && isDoubles && servingLeft && (
                  <div className="text-base text-green-400 font-bold mt-0.5">Server {gameState.serverNumber}</div>
                )}
              </div>
              <span className="text-3xl text-white/20 pt-1 px-1">—</span>
              <div className="flex-1 text-center">
                <span className={`text-5xl font-black tabular-nums ${rightWon ? "text-green-400" : rightColor}`}>{rightScore}</span>
                {!isRally && isDoubles && !servingLeft && (
                  <div className="text-base text-green-400 font-bold mt-0.5">Server {gameState.serverNumber}</div>
                )}
              </div>
              <button onClick={handleRedo} disabled={redoStack.length === 0}
                className="text-white/40 hover:text-white disabled:opacity-10 text-2xl px-1 pt-2 transition-colors shrink-0">→</button>
            </div>
          );
        })()}

      </div>

      {/* Status: what happened + what's next — pushed down */}
      {phase === "playing" && (
        <div className="text-center space-y-1 px-4 mt-4">
          <div className="text-base font-bold text-white">{lastActionText}</div>
          <div className="text-base text-white/80">
            {shortName(serverPlayer)} serves from the {serverSide} to {shortName(receiverPlayer)}
          </div>
        </div>
      )}

      {/* Action buttons */}
      {phase === "playing" && (
        <div className="p-3 space-y-2 border-t border-white/10 mt-auto">
          {(() => {
            const leftTeamNum = swapped ? 2 : 1;
            const rightTeamNum = swapped ? 1 : 2;
            const leftColor = swapped ? "bg-red-600 active:bg-red-700" : "bg-blue-600 active:bg-blue-700";
            const rightColor = swapped ? "bg-blue-600 active:bg-blue-700" : "bg-red-600 active:bg-red-700";
            return (
              <div className="flex gap-3">
                <button
                  onClick={() => handleRally(leftTeamNum)}
                  className={`flex-1 ${leftColor} text-white py-6 rounded-xl text-xl font-black transition-colors`}
                >
                  ◄ Won
                </button>
                <button
                  onClick={() => handleRally(rightTeamNum)}
                  className={`flex-1 ${rightColor} text-white py-6 rounded-xl text-xl font-black transition-colors`}
                >
                  Won ►
                </button>
              </div>
            );
          })()}

          <div className="flex items-center justify-center gap-3">
            <button onClick={handleSpeak}
              className="text-2xl px-3 py-1 hover:bg-white/10 rounded-lg transition-colors">🔊</button>
            <button onClick={() => setAutoSpeak(!autoSpeak)}
              className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${autoSpeak ? "bg-green-700 text-green-200" : "bg-white/10 text-white/40"}`}>
              {autoSpeak ? "Auto" : "Manual"}
            </button>
          </div>
        </div>
      )}

      {/* Game over */}
      {phase === "game-over" && winner && (
        <div className="p-4 space-y-3 border-t border-white/10">
          <div className="text-center">
            <div className="text-2xl font-black text-green-400 mb-1">
              🏆 Team {winner} wins!
            </div>
            <div className="text-3xl font-black tabular-nums">
              <span className="text-blue-500">{score[0]}</span>
              <span className="text-white/30 mx-2">—</span>
              <span className="text-red-500">{score[1]}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSubmit}
              className="flex-1 bg-green-600 hover:bg-green-500 text-white py-4 rounded-xl text-lg font-bold transition-colors">
              Submit Score
            </button>
            <button onClick={handleUndo}
              className="bg-white/10 hover:bg-white/20 text-white px-4 py-4 rounded-xl text-sm font-medium transition-colors">
              ↩ Undo
            </button>
          </div>
          <button onClick={onClose}
            className="w-full text-sm text-white/40 hover:text-white/60 py-2">Close without submitting</button>
        </div>
      )}
    </div>
  );
}
