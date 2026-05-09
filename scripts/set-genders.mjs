import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const DRY_RUN = !process.argv.includes("--commit");

// Name → confident gender. Names not in this map are left null.
// Ambiguous cases (Alexis, Avi, Noam, "Oun S") deliberately skipped.
const M = "M", F = "F";
const ASSIGNMENTS = {
  "Ana Cunha": F, "Ana Lopes": F, "Ana Lucas": F,
  "Bruno Rodrigues": M, "Bruno Vitorino": M,
  "Carla Umbelino": F, "Carlos Fernandes": M, "Carlos Silva": M,
  "Carol Cicone": F, "Carolina Monget-Sarrail": F, "Cristina Lopes": F,
  "Deborah Fiuza de Mello": F, "Diane Pyun": F,
  "Diogo Buccellato": M, "Diogo Bártolo": M, "Diogo Pereira": M,
  "Dora Luciano": F, "Dorin Grigoras": M,
  "Francisco Marques de Carvalho": M, "Gisela Fernandes": F,
  "Irv Pyun": M, "Ivo Daniel": M,
  "Janaina Rosas": F, "Jessica Go": F,
  "Joana Bernardino": F, "Joana Santos": F,
  "José Santos": M, "Joyce de Mello Buccellato": F,
  "João Honório": M, "João Martins": M, "João Paulo Gonçalves": M,
  "Linda Johnson": F, "Luc Taesch": M, "Ludivine Gallozzi": F,
  "Luis Miguel Ferreira": M, "Luis Pedro Ferreira": M,
  "Manuel Moreno Figueiredo": M, "Marcio Murno": M,
  "Margarida Nabiça": F, "Marlene Barardo": F, "Marta Teixeira": F,
  "Miguel Freire": M, "Miguel Teixeira": M, "Mário Álvares": M,
  "Nuno Gonçalves": M,
  "Paola Salicetti Moreno": F, "Paula Rocha": F,
  "Paulo Aguiar": M, "Pedro Braz": M,
  "Ramasamy Narayanan": M, "Raquel Amarante": F, "Renata Łupinska": F,
  "Richard Lehman": M, "Robert Escamilla": M,
  "Rodrigo Capoulas": M, "Rodrigo Quina": M, "Rômulo Sousa": M,
  "Sandra Soares": F, "Sheila Aly": F, "Sofía Pinto Mendes": F,
  "Stéphane Pires": M, "Susana Dias": F, "Suzanne Marquis": F,
  "Telmo Bernardino": M, "Tiffany Grigoras": F, "Tomás Mendes": M,
  "Vasco Laranjinha Vieira": M, "Victor Manuel Soares Cardozo": M,
  "Wilson Ribeiro": M,
};

console.log(`\n${DRY_RUN ? "[DRY RUN]" : "[COMMIT]"}\n`);

const players = await prisma.player.findMany({
  where: { status: "active", gender: null },
  select: { id: true, name: true },
});

let updated = 0;
let skipped = 0;
for (const p of players) {
  const g = ASSIGNMENTS[p.name];
  if (!g) {
    console.log(`  SKIP (no rule): ${p.name}`);
    skipped++;
    continue;
  }
  console.log(`  ${g === "M" ? "♂" : "♀"} ${p.name}`);
  if (!DRY_RUN) {
    await prisma.player.update({ where: { id: p.id }, data: { gender: g } });
  }
  updated++;
}

console.log(`\n=== SUMMARY ===`);
console.log(`  Updated:  ${updated}`);
console.log(`  Skipped:  ${skipped} (left without gender)`);
console.log(`\n${DRY_RUN ? "DRY RUN — re-run with --commit to apply." : "COMMITTED."}`);

await prisma.$disconnect();
