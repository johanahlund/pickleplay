interface PlayerAvatarProps {
  photoUrl?: string | null;
  emoji: string;
  name: string;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "w-6 h-6 text-sm",
  md: "w-10 h-10 text-xl",
  lg: "w-16 h-16 text-3xl",
};

export function PlayerAvatar({ photoUrl, emoji, name, size = "md" }: PlayerAvatarProps) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className={`${sizeClasses[size]} rounded-full object-cover`}
      />
    );
  }

  return (
    <span className={`${sizeClasses[size]} flex items-center justify-center`}>
      {emoji}
    </span>
  );
}
