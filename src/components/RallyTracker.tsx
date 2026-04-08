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
  team1Players: RallyPlayer[];
  team2Players: RallyPlayer[];
  scoringFormat: string; // "1x11", "3x11", "1xR15", etc.
  winBy: string; // "1", "2", "cap15", etc.
  onStartMatch: () => Promise<void>;
  onSubmitScore: (team1Score: number, team2Score: number) => void;
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

type Phase = "pick-sides" | "pick-server" | "pick-receiver" | "playing" | "game-over";

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
  team1Players,
  team2Players,
  scoringFormat,
  winBy,
  onStartMatch,
  onSubmitScore,
  onClose,
}: RallyTrackerProps) {
  const { isRally, targetScore } = parseFormat(scoringFormat);
  const { winByN, cap } = parseWinBy(winBy);
  const isDoubles = team1Players.length === 2 && team2Players.length === 2;

  const [phase, setPhase] = useState<Phase>("pick-sides");
  const [selectedServer, setSelectedServer] = useState<RallyPlayer | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [swapped, setSwapped] = useState(false); // swap screen sides for teams

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [history, setHistory] = useState<GameState[]>([]); // all states, index 0 = initial
  const [redoStack, setRedoStack] = useState<{ state: GameState; winner: 1 | 2 | null }[]>([]);
  const [winner, setWinner] = useState<1 | 2 | null>(null);

  // Format label
  const formatLabel = isRally ? "Rally" : "Side-out";
  const winByLabel = cap ? `cap ${cap}` : `win by ${winByN}`;

  // Step 1: Pick server
  const handlePickServer = (player: RallyPlayer, team: 1 | 2) => {
    setSelectedServer(player);
    if (!isDoubles) {
      // Singles: server picked, receiver is the opponent
      const opponent = team === 1 ? team2Players[0] : team1Players[0];
      initGame(player, opponent, team);
    } else {
      setPhase("pick-receiver");
    }
  };

  // Step 2: Pick receiver (doubles only)
  const handlePickReceiver = (receiver: RallyPlayer) => {
    if (!selectedServer) return;
    const serverTeam = team1Players.some((p) => p.id === selectedServer.id) ? 1 : 2;
    initGame(selectedServer, receiver, serverTeam as 1 | 2);
  };

  // Initialize game state from server + receiver picks
  const initGame = (server: RallyPlayer, receiver: RallyPlayer, serverTeam: 1 | 2) => {
    // Server is on the RIGHT (game always starts from right)
    // Receiver is DIAGONAL from server, so receiver is on the LEFT of their team
    let court: CourtState;

    if (!isDoubles) {
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
      serverNumber: 2, // Game starts at Server 2 (first-serve exception)
      serverId: server.id,
      court,
      isFirstServe: true,
    };

    setGameState(state);
    setHistory([]);
    setPhase("playing");

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
        if (newState.isFirstServe) {
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
    if (!gameState) return;
    speak(buildAnnouncement(gameState, isRally, targetScore, winByN, cap));
  };

  const handleSubmit = () => {
    if (!gameState) return;
    onSubmitScore(gameState.score[0], gameState.score[1]);
  };

  // ── RENDER: Pick Sides ──
  if (phase === "pick-sides") {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col text-white">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-sm opacity-60">{formatLabel} · to {targetScore} · {winByLabel}</span>
          <button onClick={onClose} className="text-white/60 hover:text-white text-lg">✕</button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-8">
          <h2 className="text-xl font-bold">Which side is Team A on?</h2>
          <div className="text-sm text-white/40 text-center">As seen from where you sit (at the net)</div>
          <div className="flex gap-6">
            <button onClick={() => { setSwapped(false); setPhase("pick-server"); }}
              className="flex flex-col items-center gap-3 bg-blue-900/40 hover:bg-blue-800/50 border-2 border-blue-500/50 rounded-2xl px-8 py-6 transition-colors">
              <span className="text-4xl">◄</span>
              <span className="text-lg font-bold text-blue-300">Team A</span>
              <span className="text-xs text-white/40">Left side</span>
            </button>
            <button onClick={() => { setSwapped(true); setPhase("pick-server"); }}
              className="flex flex-col items-center gap-3 bg-blue-900/40 hover:bg-blue-800/50 border-2 border-blue-500/50 rounded-2xl px-8 py-6 transition-colors">
              <span className="text-4xl">►</span>
              <span className="text-lg font-bold text-blue-300">Team A</span>
              <span className="text-xs text-white/40">Right side</span>
            </button>
          </div>
          <div className="text-xs text-white/30 text-center">
            Team A: {team1Players.map((p) => p.name).join(" & ")}<br/>
            Team B: {team2Players.map((p) => p.name).join(" & ")}
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER: Pick Server ──
  if (phase === "pick-server") {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col text-white">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-sm opacity-60">{formatLabel} · to {targetScore} · {winByLabel}</span>
          <button onClick={onClose} className="text-white/60 hover:text-white text-lg">✕</button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-8">
          <h2 className="text-xl font-bold">Who serves first?</h2>
          <div className="space-y-3 w-full max-w-xs">
            <div className="text-xs text-white/50 uppercase tracking-wider text-center mb-1">Team A</div>
            {team1Players.map((p) => (
              <button key={p.id} onClick={() => handlePickServer(p, 1)}
                className="w-full flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-xl px-4 py-3 transition-colors">
                <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                <span className="text-lg font-semibold">{p.name}</span>
              </button>
            ))}
            <div className="text-xs text-white/50 uppercase tracking-wider text-center mb-1 mt-6">Team B</div>
            {team2Players.map((p) => (
              <button key={p.id} onClick={() => handlePickServer(p, 2)}
                className="w-full flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-xl px-4 py-3 transition-colors">
                <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                <span className="text-lg font-semibold">{p.name}</span>
              </button>
            ))}
          </div>
          <button onClick={() => setPhase("pick-sides")}
            className="text-sm text-white/40 hover:text-white/60">← Back</button>
        </div>
      </div>
    );
  }

  // ── RENDER: Pick Receiver ──
  if (phase === "pick-receiver" && selectedServer) {
    const serverTeam = team1Players.some((p) => p.id === selectedServer.id) ? 1 : 2;
    const opponents = serverTeam === 1 ? team2Players : team1Players;
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col text-white">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-sm opacity-60">{formatLabel} · to {targetScore} · {winByLabel}</span>
          <button onClick={onClose} className="text-white/60 hover:text-white text-lg">✕</button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-8">
          <div className="text-center">
            <div className="text-sm text-white/50 mb-1">Server</div>
            <div className="flex items-center gap-2 justify-center">
              <PlayerAvatar name={selectedServer.name} photoUrl={selectedServer.photoUrl} size="sm" />
              <span className="text-lg font-bold text-green-400">{selectedServer.name}</span>
            </div>
          </div>
          <h2 className="text-xl font-bold">Who receives?</h2>
          <div className="space-y-3 w-full max-w-xs">
            {opponents.map((p) => (
              <button key={p.id} onClick={() => handlePickReceiver(p)}
                className="w-full flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-xl px-4 py-3 transition-colors">
                <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                <span className="text-lg font-semibold">{p.name}</span>
              </button>
            ))}
          </div>
          <button onClick={() => { setSelectedServer(null); setPhase("pick-server"); }}
            className="text-sm text-white/40 hover:text-white/60">← Back</button>
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
      <div className={`flex-1 flex flex-col items-center justify-center rounded-xl p-3 border-2 transition-all ${
        isServer
          ? "border-green-400 bg-green-900/40 animate-pulse"
          : isReceiver
            ? "border-orange-400 bg-orange-900/30"
            : `border-${teamColor}-800/30 bg-${teamColor}-950/20`
      }`}>
        <PlayerAvatar name={player.name} photoUrl={player.photoUrl} size="md" />
        <span className={`text-base font-bold mt-1 ${isServer ? "text-green-400" : isReceiver ? "text-orange-400" : "text-white/80"}`}>
          {player.name}
        </span>
        {isServer && <span className="text-[10px] text-green-300 font-medium mt-0.5">SERVING</span>}
        {isReceiver && <span className="text-[10px] text-orange-300 font-medium mt-0.5">RECEIVING</span>}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col text-white select-none">
      {/* Header: score + info */}
      <div className="px-4 py-2 border-b border-white/10">
        <div className="flex items-center justify-between">
          <span className="text-xs opacity-40">{formatLabel} · to {targetScore} · {winByLabel}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setAutoSpeak(!autoSpeak)}
              className={`text-xs px-2 py-0.5 rounded ${autoSpeak ? "bg-green-700 text-green-200" : "bg-white/10 text-white/40"}`}>
              {autoSpeak ? "🔊 Auto" : "🔇"}
            </button>
            <button onClick={onClose} className="text-white/40 hover:text-white text-lg">✕</button>
          </div>
        </div>

        {/* Score display */}
        <div className="flex items-center justify-center gap-4 py-2">
          <div className="text-center">
            <div className={`text-xs uppercase tracking-wider mb-0.5 ${swapped ? "text-red-300" : "text-blue-300"}`}>{swapped ? "Team B" : "Team A"}</div>
            <span className={`text-5xl font-black tabular-nums ${(swapped ? winner === 2 : winner === 1) ? "text-green-400" : swapped ? "text-red-400" : "text-blue-400"}`}>{swapped ? score[1] : score[0]}</span>
          </div>
          <div className="text-center">
            <span className="text-2xl text-white/20">—</span>
            {!isRally && (
              <div className="text-xs text-white/40 mt-0.5">S{gameState.serverNumber}</div>
            )}
          </div>
          <div className="text-center">
            <div className={`text-xs uppercase tracking-wider mb-0.5 ${swapped ? "text-blue-300" : "text-red-300"}`}>{swapped ? "Team A" : "Team B"}</div>
            <span className={`text-5xl font-black tabular-nums ${(swapped ? winner === 1 : winner === 2) ? "text-green-400" : swapped ? "text-blue-400" : "text-red-400"}`}>{swapped ? score[0] : score[1]}</span>
          </div>
        </div>

        {gamePointActive && !winner && (
          <div className="text-center">
            <span className="text-sm font-bold text-yellow-400 animate-pulse">🏆 Game Point!</span>
          </div>
        )}
      </div>

      {/* Court view */}
      {(() => {
        const topLeft = swapped ? court.team2Left : court.team1Left;
        const topRight = swapped ? court.team2Right : court.team1Right;
        const topLPos = swapped ? "t2l" as const : "t1l" as const;
        const topRPos = swapped ? "t2r" as const : "t1r" as const;
        const botLeft = swapped ? court.team1Left : court.team2Left;
        const botRight = swapped ? court.team1Right : court.team2Right;
        const botLPos = swapped ? "t1l" as const : "t2l" as const;
        const botRPos = swapped ? "t1r" as const : "t2r" as const;
        return (
          <div className="flex-1 flex flex-col p-3 gap-2 min-h-0">
            <div className="flex-1 flex gap-2">
              {isDoubles ? <>{renderCourtPlayer(topLeft, topLPos)}{renderCourtPlayer(topRight, topRPos)}</> : renderCourtPlayer(topLeft, topLPos)}
            </div>
            {/* Net + swap button */}
            <div className="flex items-center gap-2 py-1.5">
              <div className="flex-1 h-1 bg-white/30 rounded-full" />
              <button onClick={() => setSwapped(!swapped)} className="text-xs text-white/50 uppercase tracking-widest font-bold px-2 hover:text-white/80 transition-colors" title="Swap sides">
                ⇅ NET
              </button>
              <div className="flex-1 h-1 bg-white/30 rounded-full" />
            </div>
            <div className="flex-1 flex gap-2">
              {isDoubles ? <>{renderCourtPlayer(botLeft, botLPos)}{renderCourtPlayer(botRight, botRPos)}</> : renderCourtPlayer(botLeft, botLPos)}
            </div>
          </div>
        );
      })()}

      {/* Action buttons */}
      {phase === "playing" && (
        <div className="p-3 space-y-2 border-t border-white/10">
          {/* Serve info */}
          <div className="text-center text-sm text-white/50">
            {findPlayer(court, serverId).name} serves from the {serverSide} to {findPlayer(court, receiverId).name}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => handleRally(swapped ? 2 : 1)}
              className={`flex-1 ${swapped ? "bg-red-600 hover:bg-red-500 active:bg-red-700" : "bg-blue-600 hover:bg-blue-500 active:bg-blue-700"} text-white py-6 rounded-xl text-xl font-black transition-colors`}
            >
              ◄ {swapped ? "TEAM B" : "TEAM A"}
            </button>
            <button
              onClick={() => handleRally(swapped ? 1 : 2)}
              className={`flex-1 ${swapped ? "bg-blue-600 hover:bg-blue-500 active:bg-blue-700" : "bg-red-600 hover:bg-red-500 active:bg-red-700"} text-white py-6 rounded-xl text-xl font-black transition-colors`}
            >
              {swapped ? "TEAM A" : "TEAM B"} ►
            </button>
          </div>

          <div className="flex items-center justify-between">
            <button onClick={handleUndo} disabled={history.length === 0}
              className="text-sm text-white/40 hover:text-white/70 disabled:opacity-20 px-3 py-1">
              ◄ Back
            </button>
            <button onClick={handleSpeak}
              className="text-2xl px-3 py-1 hover:bg-white/10 rounded-lg transition-colors">🔊</button>
            <button onClick={handleRedo} disabled={redoStack.length === 0}
              className="text-sm text-white/40 hover:text-white/70 disabled:opacity-20 px-3 py-1">
              Forward ►
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
              <span className="text-blue-400">{score[0]}</span>
              <span className="text-white/30 mx-2">—</span>
              <span className="text-red-400">{score[1]}</span>
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
