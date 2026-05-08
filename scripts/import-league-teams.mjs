import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const DRY_RUN = !process.argv.includes("--commit");

const LEAGUE_ID = "cmnthgg6u0001js043pt46mpy"; // I Liga Interclubes Pickleball Zona Centro - Portugal

// Clubs to include as teams. Setúbal/Pickle Novopadel Setubal is excluded.
const CLUB_NAMES = ["Caldas", "Estoril", "Leiria", "Lisboa", "Lourinhã", "Oeiras", "Torres Vedras"];

// Existing teams that need updating (rename / link to club)
const TEAM_UPDATES = {
  "Leira": { rename: "Leiria", linkClub: "Leiria" },
  "Caldas": { linkClub: "Caldas" },
};

// Player names to never add to teams (test data)
const SKIP_NAMES = new Set(["Test User", "Joe Blow"]);

console.log(`\n${DRY_RUN ? "[DRY RUN]" : "[COMMIT]"}\n`);

const league = await prisma.league.findUnique({
  where: { id: LEAGUE_ID },
  select: { id: true, name: true, teams: { select: { id: true, name: true, clubId: true } } },
});
console.log(`League: ${league.name}\n`);

// Resolve clubs
const clubByName = {};
for (const cn of CLUB_NAMES) {
  const c = await prisma.club.findFirst({ where: { name: cn }, select: { id: true, name: true } });
  if (!c) { console.log(`  ! Club not found: ${cn}`); continue; }
  clubByName[cn] = c;
}

// 1) Update existing teams
const teamByClubId = {};
for (const t of league.teams) {
  const update = TEAM_UPDATES[t.name];
  if (update) {
    const targetClub = update.linkClub ? clubByName[update.linkClub] : null;
    const newName = update.rename || t.name;
    const data = {};
    if (newName !== t.name) data.name = newName;
    if (targetClub && t.clubId !== targetClub.id) data.clubId = targetClub.id;
    if (Object.keys(data).length > 0) {
      console.log(`UPDATE team "${t.name}" → ${JSON.stringify(data)}`);
      if (!DRY_RUN) await prisma.leagueTeam.update({ where: { id: t.id }, data });
    }
    if (targetClub) teamByClubId[targetClub.id] = { id: t.id, name: newName, clubId: targetClub.id };
  } else {
    if (t.clubId) teamByClubId[t.clubId] = { id: t.id, name: t.name, clubId: t.clubId };
  }
}

// 2) Create teams for remaining clubs
for (const cn of CLUB_NAMES) {
  const club = clubByName[cn];
  if (!club) continue;
  if (teamByClubId[club.id]) continue;
  // Also skip if a team exists with same name but no clubId (shouldn't happen after step 1)
  const existing = league.teams.find((t) => t.name === cn);
  if (existing && !existing.clubId) {
    console.log(`UPDATE team "${cn}" → link to club`);
    if (!DRY_RUN) await prisma.leagueTeam.update({ where: { id: existing.id }, data: { clubId: club.id } });
    teamByClubId[club.id] = { id: existing.id, name: cn, clubId: club.id };
    continue;
  }
  console.log(`CREATE team "${cn}" → club ${club.name}`);
  if (DRY_RUN) {
    teamByClubId[club.id] = { id: `__pending_${cn}`, name: cn, clubId: club.id };
  } else {
    const t = await prisma.leagueTeam.create({
      data: { leagueId: LEAGUE_ID, clubId: club.id, name: cn },
      select: { id: true, name: true, clubId: true },
    });
    teamByClubId[club.id] = t;
  }
}

console.log("");

// 3) Add club members as team players
let added = 0, alreadyOn = 0;
for (const cn of CLUB_NAMES) {
  const club = clubByName[cn];
  if (!club) continue;
  const team = teamByClubId[club.id];
  if (!team) { console.log(`  ! No team for club ${cn}`); continue; }

  const members = await prisma.clubMember.findMany({
    where: { clubId: club.id, player: { status: "active" } },
    select: { player: { select: { id: true, name: true } } },
  });

  // Existing team players (skip these)
  const existingTeamPlayers = DRY_RUN
    ? await prisma.leagueTeamPlayer.findMany({ where: { teamId: team.id }, select: { playerId: true } })
    : await prisma.leagueTeamPlayer.findMany({ where: { teamId: team.id }, select: { playerId: true } });
  const existingIds = new Set(existingTeamPlayers.map((p) => p.playerId));

  console.log(`Team ${team.name} (${members.length} club members, ${existingIds.size} already on team):`);
  for (const { player } of members) {
    if (SKIP_NAMES.has(player.name)) {
      console.log(`  SKIP (test player): ${player.name}`);
      continue;
    }
    if (existingIds.has(player.id)) {
      console.log(`  SKIP (already on team): ${player.name}`);
      alreadyOn++;
      continue;
    }
    if (DRY_RUN) {
      console.log(`  ADD: ${player.name}`);
    } else {
      await prisma.leagueTeamPlayer.create({ data: { teamId: team.id, playerId: player.id } });
      console.log(`  ADD: ${player.name}`);
    }
    added++;
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`  Players added to teams: ${added}`);
console.log(`  Already on team:        ${alreadyOn}`);
console.log(`\n${DRY_RUN ? "DRY RUN — re-run with --commit to apply." : "COMMITTED."}`);

await prisma.$disconnect();
