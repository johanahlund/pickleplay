// Icon.tsx — Rally icon system
// 24×24, currentColor, stroke 2.25 for outdoor readability.
// Usage: <Icon name="trophy" size={22} color="#16a34a" />

interface IconProps {
  name: string;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
  className?: string;
}

export default function Icon({ name, size = 22, color, style, className }: IconProps) {
  const s = { width: size, height: size, color, flexShrink: 0, ...style };
  const stroke = {
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 2.25,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const paths = {
    pickleball: (
      <g>
        <defs>
          <radialGradient id="pj-ball-grad" cx="38%" cy="32%" r="72%">
            <stop offset="0%"   stopColor="#ECFCCB" />
            <stop offset="35%"  stopColor="#D9F99D" />
            <stop offset="70%"  stopColor="#BEF264" />
            <stop offset="100%" stopColor="#84CC16" />
          </radialGradient>
        </defs>
        <circle cx="12" cy="12" r="9.7" fill="url(#pj-ball-grad)" />
        {[
          [12, 6.5, 0.95], [7.5, 9, 0.95], [16.5, 9, 0.95],
          [12, 12, 0.95],  [7.5, 15, 0.9], [16.5, 15, 0.9],
          [12, 17.5, 0.85],
        ].map(([x, y, o], i) => (
          <circle key={i} cx={x} cy={y} r="1.15" fill="#F7FEE7" opacity={o} />
        ))}
      </g>
    ),
    paddle: (
      <g>
        <path
          d="M7 2.5 C7 1.67 7.67 1 8.5 1 H15.5 C16.33 1 17 1.67 17 2.5 V14.5 C17 15.33 16.33 16 15.5 16 H13 L13.2 17.5 H10.8 L11 16 H8.5 C7.67 16 7 15.33 7 14.5 Z"
          fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinejoin="round"
        />
        <rect x="10" y="17.2" width="4" height="5.3" rx="0.9"
          fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinejoin="round" />
      </g>
    ),
    court: (
      <g>
        <rect x="3" y="6" width="18" height="12" rx="1.5" {...stroke} />
        <line x1="12" y1="6" x2="12" y2="18"
          stroke="currentColor" strokeWidth="1.75" strokeDasharray="1.5 1.5" />
      </g>
    ),
    trophy: (
      <path
        d="M7 4h10v4a5 5 0 0 1-10 0V4zM7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3M12 13v4M9 20h6M10 17h4v3h-4z"
        {...stroke}
      />
    ),
    calendar: (
      <g {...stroke}>
        <rect x="3.5" y="5" width="17" height="15" rx="2" />
        <line x1="3.5" y1="10" x2="20.5" y2="10" />
        <line x1="8" y1="3" x2="8" y2="7" />
        <line x1="16" y1="3" x2="16" y2="7" />
      </g>
    ),
    players: (
      <g {...stroke}>
        <circle cx="9" cy="8" r="3.25" />
        <path d="M3 19.5c0-3 2.7-5 6-5s6 2 6 5" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M15.5 14.5c2.5.3 5 1.8 5 5" />
      </g>
    ),
    user: (
      <g {...stroke}>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M4.5 20c0-3.5 3.3-6 7.5-6s7.5 2.5 7.5 6" />
      </g>
    ),
    clubs: (
      <g {...stroke}>
        <path d="M4 20V11l4-3 4 3v9" />
        <path d="M12 20v-6l4-3 4 3v6" />
        <path d="M4 20h16" />
      </g>
    ),
    edit: (
      <g {...stroke}>
        <path d="M4 20h4l10-10-4-4L4 16v4z" />
        <path d="M13.5 6.5l4 4" />
      </g>
    ),
    bell: (
      <g {...stroke}>
        <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z" />
        <path d="M10 20.5a2 2 0 0 0 4 0" />
      </g>
    ),
    check: (
      <g {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <path d="M7.5 12.2 10.5 15l6-6" />
      </g>
    ),
    plus: (
      <g {...stroke}>
        <line x1="12" y1="5"  x2="12" y2="19" />
        <line x1="5"  y1="12" x2="19" y2="12" />
      </g>
    ),
    search: (
      <g {...stroke}>
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4.5 4.5" />
      </g>
    ),
    settings: (
      <g {...stroke}>
        <circle cx="12" cy="12" r="2.8" />
        <path d="M12 3v2.5M12 18.5V21M4.2 7l2.2 1.3M17.6 15.7l2.2 1.3M4.2 17l2.2-1.3M17.6 8.3l2.2-1.3M3 12h2.5M18.5 12H21" />
      </g>
    ),
    close: <path d="M6 6l12 12M18 6L6 18" {...stroke} />,
    chevron: <path d="M9 5l7 7-7 7" {...stroke} />,
  };

  return (
    <svg viewBox="0 0 24 24" style={s} className={className} aria-hidden="true">
      {(paths as Record<string, React.ReactNode>)[name]}
    </svg>
  );
}
