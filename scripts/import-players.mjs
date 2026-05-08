import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes("--commit") ? false : true;

// Portuguese / European particles that stay lowercase mid-name
const LOWERCASE_PARTICLES = new Set([
  "de", "da", "do", "dos", "das", "e", "di", "du", "von", "van", "la", "le",
]);

function titleCase(s) {
  const parts = s.trim().split(/(\s+|-)/);
  let firstWordIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    if (!/^\s+$/.test(parts[i]) && parts[i] !== "-" && parts[i]) { firstWordIdx = i; break; }
  }
  return parts.map((part, i) => {
    if (/^\s+$/.test(part) || part === "-" || !part) return part;
    const lower = part.toLocaleLowerCase("pt-PT");
    if (i !== firstWordIdx && LOWERCASE_PARTICLES.has(lower)) return lower;
    return part[0].toLocaleUpperCase("pt-PT") + part.slice(1).toLocaleLowerCase("pt-PT");
  }).join("");
}

// Club name remap: input label → actual DB club name
const CLUB_REMAP = {
  "Setúbal": "Pickle Novopadel Setubal",
};

// Player name remap: input name → existing DB record to use instead.
// Used when the spreadsheet name doesn't match the DB exactly. The existing
// record will be renamed to the input name.
const PLAYER_RENAME = {
  "Johan Ahlund": "Johan A",
};

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
  ["Carlos Fernandes", "Lourinhã"], ["Bruno Rodrigues", "Lourinhã"],
  // "Gallozzi ludivine" merged into "Ludivine Gallozzi" per user decision
  ["Ludivine Gallozzi", "Lourinhã"],
  ["Irv Pyun", "Lourinhã"], ["Diane Pyun", "Lourinhã"],
  ["Carla Umbelino", "Lourinhã"], ["Luis Miguel Ferreira", "Lourinhã"], ["Linda Johnson", "Lourinhã"],
  ["Ana Cunha", "Lourinhã"],
  ["Carlos Silva", "Oeiras"], ["Alexis Tam", "Oeiras"], ["Rômulo Sousa", "Oeiras"], ["José Santos", "Oeiras"],
  ["Cristina Lopes", "Oeiras"], ["Susana Dias", "Oeiras"],
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

// Normalize names + remap clubs
const inputPlayers = rawPlayers.map(([n, c]) => [titleCase(n), CLUB_REMAP[c] || c]);

console.log(`\n${DRY_RUN ? "[DRY RUN]" : "[COMMIT]"} Players: ${inputPlayers.length}\n`);

// 1) Resolve / create clubs
const inputClubNames = [...new Set(inputPlayers.map(([, c]) => c))];
const clubByName = {};

for (const cn of inputClubNames) {
  let club = await prisma.club.findFirst({ where: { name: cn }, select: { id: true, name: true, emoji: true } });
  if (club) {
    console.log(`CLUB: existing → ${club.emoji} ${club.name}`);
  } else {
    if (DRY_RUN) {
      console.log(`CLUB: would create → ${cn}`);
      club = { id: `__pending_${cn}`, name: cn, emoji: "🏟️" };
    } else {
      club = await prisma.club.create({
        data: { name: cn, emoji: "🏟️" },
        select: { id: true, name: true, emoji: true },
      });
      console.log(`CLUB: created → ${club.emoji} ${club.name} (${club.id})`);
    }
  }
  clubByName[cn] = club;
}

console.log("");

// 2) Resolve / create players + link to club
let createdCount = 0, linkedExistingCount = 0, alreadyLinkedCount = 0, renamedCount = 0;

for (const [name, clubName] of inputPlayers) {
  const club = clubByName[clubName];
  const lookupName = PLAYER_RENAME[name] || name;
  // Case-insensitive lookup, prefer exact-match first
  const existing = await prisma.player.findFirst({
    where: { name: { equals: lookupName, mode: "insensitive" }, status: { not: "voided" } },
    select: {
      id: true, name: true,
      clubMembers: { select: { clubId: true, club: { select: { name: true } } } },
    },
  });

  // Rename existing record if needed
  if (existing && PLAYER_RENAME[name] && existing.name !== name) {
    if (DRY_RUN) {
      console.log(`  RENAME: "${existing.name}" → "${name}"`);
    } else {
      await prisma.player.update({ where: { id: existing.id }, data: { name } });
      console.log(`  RENAME: "${existing.name}" → "${name}"`);
    }
    existing.name = name;
    renamedCount++;
  }

  if (existing) {
    const inClub = existing.clubMembers.some((m) => m.clubId === club.id);
    if (inClub) {
      console.log(`  SKIP (already linked): ${existing.name} ↔ ${club.name}`);
      alreadyLinkedCount++;
    } else {
      if (DRY_RUN) {
        console.log(`  LINK existing: ${existing.name} → ${club.name}`);
      } else {
        await prisma.clubMember.create({
          data: { clubId: club.id, playerId: existing.id, role: "member" },
        });
        console.log(`  LINK existing: ${existing.name} → ${club.name}`);
      }
      linkedExistingCount++;
    }
  } else {
    if (DRY_RUN) {
      console.log(`  CREATE: ${name} → ${club.name}`);
    } else {
      const player = await prisma.player.create({
        data: { name, emoji: "🏓" },
      });
      await prisma.clubMember.create({
        data: { clubId: club.id, playerId: player.id, role: "member" },
      });
      console.log(`  CREATE: ${player.name} (${player.id}) → ${club.name}`);
    }
    createdCount++;
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`  New players created:       ${createdCount}`);
console.log(`  Existing linked to club:   ${linkedExistingCount}`);
console.log(`  Already correctly linked:  ${alreadyLinkedCount}`);
console.log(`  Existing records renamed:  ${renamedCount}`);
console.log(`  Total processed:           ${inputPlayers.length}`);
console.log(`\n${DRY_RUN ? "DRY RUN — re-run with --commit to apply." : "COMMITTED."}`);

await prisma.$disconnect();
