import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Title-case: first letter of each whitespace- or hyphen-separated word capitalized,
// rest lowercased. Preserves the original separators.
function titleCase(s) {
  return s
    .trim()
    .split(/(\s+|-)/)
    .map((part) => {
      if (/^\s+$/.test(part) || part === "-") return part;
      if (!part) return part;
      return part[0].toLocaleUpperCase("pt-PT") + part.slice(1).toLocaleLowerCase("pt-PT");
    })
    .join("");
}

const inputClubs = ["Caldas", "Estoril", "Leiria", "Lisboa", "Lourinhã", "Oeiras", "Setúbal", "Torres Vedras"];

const rawPlayers = [
  ["Marcio Murno", "Caldas"], ["Oun S", "Caldas"], ["Joana Bernardino", "Caldas"], ["Renata Łupinska", "Caldas"],
  ["Ivo Daniel", "Caldas"], ["Dorin Grigoras", "Caldas"], ["Tiffany Grigoras", "Caldas"], ["Suzanne Marquis", "Caldas"],
  ["Noam Goldfarb", "Caldas"], ["Telmo Bernardino", "Caldas"], ["Avi", "Caldas"],
  ["João Martins", "Estoril"], ["Rodrigo Capoulas", "Estoril"], ["Vasco Laranjinha Vieira", "Estoril"],
  ["Deborah Fiuza de Mello", "Estoril"], ["Carolina Monget-Sarrail", "Estoril"], ["Marta Teixeira", "Estoril"],
  ["Miguel Freire", "Estoril"], ["Joyce de Mello Buccellato", "Estoril"], ["Diogo Buccellato", "Estoril"],
  ["Diogo Bártolo", "Leiria"], ["Margarida Nabiça", "Leiria"], ["João Honório", "Leiria"],
  ["Raquel Amarante", "Leiria"], ["Dora Luciano", "Leiria"], ["Paulo Aguiar", "Leiria"], ["Pedro Braz", "Leiria"],
  ["Gonçalo Pina", "Lisboa"], ["Wilson Ribeiro", "Lisboa"], ["Diogo Pereira", "Lisboa"],
  ["Paola Salicetti Moreno", "Lisboa"], ["Sheila Aly", "Lisboa"], ["Tomás Mendes", "Lisboa"],
  ["Ana Lucas", "Lourinhã"], ["Luis Pedro Ferreira", "Lourinhã"], ["robert escamilla", "Lourinhã"],
  ["Nuno Gonçalves", "Lourinhã"], ["Paula Rocha", "Lourinhã"], ["Stéphane Pires", "Lourinhã"],
  ["Mário Álvares", "Lourinhã"], ["luc taesch", "Lourinhã"], ["Marlene Barardo", "Lourinhã"],
  ["Carlos Fernandes", "Lourinhã"], ["Bruno Rodrigues", "Lourinhã"], ["Gallozzi ludivine", "Lourinhã"],
  ["Ludivine Gallozzi", "Lourinhã"], ["Irv Pyun", "Lourinhã"], ["Diane Pyun", "Lourinhã"],
  ["Carla Umbelino", "Lourinhã"], ["Luis Miguel Ferreira", "Lourinhã"], ["Linda Johnson", "Lourinhã"],
  ["Ana Cunha", "Lourinhã"],
  ["Carlos Silva", "Oeiras"], ["Alexis Tam", "Oeiras"], ["Rômulo Sousa", "Oeiras"], ["José Santos", "Oeiras"],
  ["Cristina Lopes", "Oeiras"], ["Rômulo Sousa", "Oeiras"], ["Susana Dias", "Oeiras"],
  ["Manuel Moreno Figueiredo", "Oeiras"], ["Sofía Pinto Mendes", "Oeiras"], ["Sandra Soares", "Oeiras"],
  ["João Paulo Gonçalves", "Oeiras"], ["Janaina Rosas", "Oeiras"], ["RAMASAMY NARAYANAN", "Oeiras"],
  ["Joana Santos", "Oeiras"],
  ["Fernando Neves", "Setúbal"], ["Johan Ahlund", "Setúbal"],
  ["Rodrigo Quina", "Torres Vedras"], ["Bruno Vitorino", "Torres Vedras"], ["Richard Lehman", "Torres Vedras"],
  ["Gisela Fernandes", "Torres Vedras"], ["Ana Lopes", "Torres Vedras"],
  ["Francisco Marques de Carvalho", "Torres Vedras"], ["Jessica Go", "Torres Vedras"],
  ["Miguel Teixeira", "Torres Vedras"], ["Victor Manuel Soares Cardozo", "Torres Vedras"],
  ["Carol Cicone", "Torres Vedras"],
];

// Normalize names to title case
const inputPlayers = rawPlayers.map(([n, c]) => [titleCase(n), c]);

console.log("=== TITLE-CASING CHANGES ===");
for (let i = 0; i < rawPlayers.length; i++) {
  if (rawPlayers[i][0] !== inputPlayers[i][0]) {
    console.log(`  "${rawPlayers[i][0]}" → "${inputPlayers[i][0]}"`);
  }
}

console.log("\n=== INPUT DUPLICATES ===");
const seen = new Map();
for (const [n, c] of inputPlayers) {
  const k = n.toLowerCase().trim();
  if (seen.has(k)) console.log(`  DUP: "${n}" appears multiple times (${seen.get(k)}, ${c})`);
  else seen.set(k, c);
}

console.log("\n=== POTENTIAL NAME-ORDER VARIANTS IN INPUT ===");
const tokens = new Map();
for (const [n] of inputPlayers) {
  const norm = n.toLowerCase().split(/\s+/).sort().join(" ");
  if (tokens.has(norm) && tokens.get(norm) !== n) {
    console.log(`  Same tokens, different order: "${tokens.get(norm)}" vs "${n}"`);
  } else {
    tokens.set(norm, n);
  }
}

console.log("\n=== CLUB MATCHES IN DB ===");
const allClubs = await prisma.club.findMany({ select: { id: true, name: true, emoji: true } });
for (const c of inputClubs) {
  const cl = c.toLowerCase();
  const matches = allClubs.filter((dc) => {
    const dcl = dc.name.toLowerCase();
    return dcl === cl || dcl.includes(cl) || cl.includes(dcl);
  });
  if (matches.length === 0) {
    console.log(`  NEW: "${c}" — will create`);
  } else if (matches.length === 1 && matches[0].name.toLowerCase() === cl) {
    console.log(`  EXISTS exact: "${c}" → ${matches[0].emoji} ${matches[0].name} (${matches[0].id})`);
  } else {
    console.log(`  AMBIGUOUS: "${c}" → ${matches.map((m) => `${m.emoji} ${m.name}`).join(", ")}`);
  }
}

console.log("\n=== PLAYER EXACT NAME COLLISIONS IN DB ===");
const allPlayers = await prisma.player.findMany({
  where: { status: "active" },
  select: { id: true, name: true, email: true, clubMembers: { select: { club: { select: { name: true } } } } },
});
const inputNames = [...new Set(inputPlayers.map(([n]) => n))];
let collisions = 0;
for (const n of inputNames) {
  const cl = n.toLowerCase().trim();
  const exact = allPlayers.filter((p) => p.name.toLowerCase().trim() === cl);
  if (exact.length > 0) {
    collisions++;
    for (const e of exact) {
      const clubs = e.clubMembers.map((m) => m.club.name).join(", ") || "—";
      console.log(`  EXACT: "${n}" already exists [${e.id}] clubs: ${clubs}`);
    }
  }
}
if (collisions === 0) console.log("  (none)");

console.log("\n=== POTENTIAL PARTIAL DB MATCHES (fuzzy, ≥2 shared tokens of length ≥4) ===");
let warned = 0;
for (const n of inputNames) {
  const inputTokens = n.toLowerCase().split(/\s+/).filter((t) => t.length >= 4);
  if (inputTokens.length === 0) continue;
  const cl = n.toLowerCase().trim();
  for (const p of allPlayers) {
    const pcl = p.name.toLowerCase().trim();
    if (pcl === cl) continue;
    const pTokens = pcl.split(/\s+/).filter((t) => t.length >= 4);
    const shared = inputTokens.filter((t) => pTokens.includes(t));
    if (shared.length >= 2) {
      console.log(`  FUZZY: "${n}" ↔ "${p.name}" [shared: ${shared.join(", ")}]`);
      warned++;
    }
  }
}
if (warned === 0) console.log("  (none)");

await prisma.$disconnect();
