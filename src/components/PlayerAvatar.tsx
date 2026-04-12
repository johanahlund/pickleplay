"use client";

import { useState } from "react";

interface PlayerAvatarProps {
  photoUrl?: string | null;
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
}

const sizeClasses = {
  xs: "w-6 h-6 text-[10px]",
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-16 h-16 text-xl",
};

// Generate a consistent color from a name
function getColor(name: string): string {
  const colors = [
    "bg-red-500", "bg-orange-500", "bg-amber-500", "bg-yellow-600",
    "bg-lime-600", "bg-green-500", "bg-emerald-500", "bg-teal-500",
    "bg-cyan-500", "bg-sky-500", "bg-blue-500", "bg-indigo-500",
    "bg-violet-500", "bg-purple-500", "bg-fuchsia-500", "bg-pink-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function PlayerAvatar({ photoUrl, name, size = "md" }: PlayerAvatarProps) {
  const [showFull, setShowFull] = useState(false);

  if (photoUrl) {
    return (
      <>
        <img
          src={photoUrl}
          alt={name}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowFull(true); }}
          className={`${sizeClasses[size]} rounded-full object-cover flex-shrink-0 cursor-pointer`}
        />
        {showFull && (
          <div
            className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center"
            onClick={() => setShowFull(false)}
          >
            <div className="relative max-w-[80vw] max-h-[80vh]">
              <img
                src={photoUrl}
                alt={name}
                className="max-w-[80vw] max-h-[80vh] rounded-2xl object-contain shadow-2xl"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent rounded-b-2xl px-4 py-3">
                <span className="text-white font-semibold text-lg">{name}</span>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className={`${sizeClasses[size]} ${getColor(name)} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`}
    >
      {getInitials(name)}
    </div>
  );
}
