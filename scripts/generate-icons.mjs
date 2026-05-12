/**
 * Generate FriendlyBall app icons (favicon + apple-touch + PWA 192/512)
 * from SVG sources, using `sharp`.
 *
 *   node scripts/generate-icons.mjs
 *
 * The pickleball glyph mirrors the one in `src/components/Logo.tsx`
 * (light-green ball with darker pattern dots). The branded versions sit
 * on the #15803d brand green; the favicon is transparent.
 */

import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Pickleball glyph — inner SVG content for a viewBox of 0 0 20 20.
// Matches Logo.tsx so the app icon and the in-app wordmark share a mark.
function ballGlyph() {
  return `
    <circle cx="10" cy="10" r="9.5" fill="#d9f99d"/>
    <circle cx="10" cy="4"  r="1.2" fill="#65a30d" opacity="0.65"/>
    <circle cx="5"  cy="7"  r="1.2" fill="#65a30d" opacity="0.65"/>
    <circle cx="15" cy="7"  r="1.2" fill="#65a30d" opacity="0.65"/>
    <circle cx="7"  cy="11" r="1.2" fill="#65a30d" opacity="0.65"/>
    <circle cx="13" cy="11" r="1.2" fill="#65a30d" opacity="0.65"/>
    <circle cx="10" cy="15" r="1.2" fill="#65a30d" opacity="0.65"/>
  `;
}

// Plain ball on transparent background — browser favicon.
function svgPlain() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
  ${ballGlyph()}
</svg>`;
}

// Ball on the brand-green square — apple-touch + PWA icons. The ball
// is inset to ~78% so iOS's auto-rounded mask doesn't clip the dots and
// the PWA maskable safe area stays clean.
function svgBranded() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
  <rect width="20" height="20" fill="#15803d"/>
  <g transform="translate(10 10) scale(0.78) translate(-10 -10)">
    ${ballGlyph()}
  </g>
</svg>`;
}

async function render(svg, size, outPath) {
  const buf = await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toBuffer();
  writeFileSync(outPath, buf);
  console.log(`✓ ${outPath} (${size}×${size})`);
}

const publicDir = resolve(process.cwd(), "public");
await render(svgPlain(),    64,  resolve(publicDir, "favicon.png"));
await render(svgBranded(), 180,  resolve(publicDir, "apple-touch-icon.png"));
await render(svgBranded(), 192,  resolve(publicDir, "icon-192.png"));
await render(svgBranded(), 512,  resolve(publicDir, "icon-512.png"));

console.log("Done.");
