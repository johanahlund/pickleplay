import sharp from "sharp";
import { writeFileSync } from "fs";

// Simple paddle icon: green rounded rect + white paddle shape
function createSvg(size) {
  const r = Math.round(size * 0.2); // corner radius
  const cx = size / 2;
  const cy = size / 2;
  const headR = Math.round(size * 0.22); // paddle head radius
  const headY = Math.round(size * 0.38);
  const handleW = Math.round(size * 0.07);
  const handleH = Math.round(size * 0.28);
  const handleY = Math.round(size * 0.55);
  const handleR = Math.round(handleW / 2);

  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" rx="${r}" fill="#16a34a"/>
  <ellipse cx="${cx}" cy="${headY}" rx="${headR}" ry="${Math.round(headR * 1.05)}" fill="white" opacity="0.95"/>
  <rect x="${cx - handleW / 2}" y="${handleY}" width="${handleW}" height="${handleH}" rx="${handleR}" fill="white" opacity="0.95"/>
  <circle cx="${Math.round(cx - headR * 0.35)}" cy="${Math.round(headY - headR * 0.2)}" r="${Math.round(headR * 0.12)}" fill="#16a34a" opacity="0.25"/>
  <circle cx="${Math.round(cx + headR * 0.3)}" cy="${Math.round(headY + headR * 0.25)}" r="${Math.round(headR * 0.12)}" fill="#16a34a" opacity="0.25"/>
  <circle cx="${Math.round(cx - headR * 0.1)}" cy="${Math.round(headY + headR * 0.5)}" r="${Math.round(headR * 0.1)}" fill="#16a34a" opacity="0.2"/>
  <circle cx="${Math.round(cx + headR * 0.5)}" cy="${Math.round(headY - headR * 0.4)}" r="${Math.round(headR * 0.1)}" fill="#16a34a" opacity="0.2"/>
</svg>`;
}

const sizes = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
];

for (const { name, size } of sizes) {
  const svg = createSvg(size);
  await sharp(Buffer.from(svg)).png().toFile(`public/${name}`);
  console.log(`Generated public/${name}`);
}

// Also create a simple favicon.ico (32x32 PNG works as favicon)
const faviconSvg = createSvg(32);
await sharp(Buffer.from(faviconSvg)).png().toFile("public/favicon.png");
console.log("Generated public/favicon.png");

console.log("Done!");
