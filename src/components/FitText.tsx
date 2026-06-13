"use client";

import { useEffect, useRef, type CSSProperties } from "react";

/**
 * Text that auto-shrinks to fit a single line — from `max`px down to `min`px —
 * and only wraps if even the floor won't fit. Re-fits on resize. Used for long
 * names that would otherwise truncate (event names, hero titles).
 *
 * Place inside a width-constrained parent (e.g. a `flex-1 min-w-0` cell); the
 * component measures its own box width.
 */
export function FitText({
  text,
  max,
  min,
  className = "",
  style,
}: {
  text: string;
  max: number;
  min: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.whiteSpace = "nowrap";
      let size = max;
      el.style.fontSize = `${size}px`;
      while (size > min && el.scrollWidth > el.clientWidth) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
      el.style.whiteSpace = el.scrollWidth > el.clientWidth ? "normal" : "nowrap";
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, max, min]);
  return (
    <div ref={ref} className={className} style={{ fontSize: max, overflow: "hidden", ...style }}>
      {text}
    </div>
  );
}

export default FitText;
