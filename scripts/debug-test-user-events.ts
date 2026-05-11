/**
 * Debug script: simulate the /api/events GET for the "Test User" so we
 * can see exactly which events get filtered out and why.
 */
import { prisma } from "../src/lib/db";

async function main() {
  const u = await prisma.player.findFirst({
    where: { name: { contains: "Test", mode: "insensitive" } },
    select: { id: true, name: true, role: true, email: true },
  });
  if (!u) { console.log("No Test User found"); return; }
  console.log("Test user:", u);
  const events = await prisma.event.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, status: true, visibility: true,
      roundId: true, createdById: true, clubId: true,
      helpers: { select: { playerId: true } },
      players: { select: { playerId: true } },
      round: {
        select: {
          league: {
            select: {
              createdById: true, deputyId: true,
              helpers: { select: { playerId: true } },
              teams: { select: { captainId: true, viceCaptainId: true, players: { select: { playerId: true } } } },
            },
          },
        },
      },
    },
  });
  console.log(`\nTotal events in DB: ${events.length}\n`);
  const isAdmin = u.role === "admin";
  console.log(`Is admin: ${isAdmin}`);
  let visible = 0, hidden = 0;
  for (const e of events) {
    const isSetup = e.status === "setup" || e.status === "draft" || e.status === "visible";
    const needsInsiderView = e.visibility === "hidden" || isSetup;
    let show: boolean;
    let reason = "";
    if (!needsInsiderView) {
      show = true;
      reason = "public";
    } else if (isAdmin) {
      show = true; reason = "app admin";
    } else {
      const league = e.round?.league;
      if (league) {
        if (league.createdById === u.id) { show = true; reason = "league creator"; }
        else if (league.deputyId === u.id) { show = true; reason = "league deputy"; }
        else if (league.helpers.some((h) => h.playerId === u.id)) { show = true; reason = "league helper"; }
        else { show = false; reason = "league event setup/hidden — not admin"; }
      } else {
        if (e.createdById === u.id) { show = true; reason = "creator"; }
        else if (e.helpers.some((h) => h.playerId === u.id)) { show = true; reason = "helper"; }
        else if (e.players.some((p) => p.playerId === u.id)) { show = true; reason = "player"; }
        else { show = false; reason = "standalone setup/hidden — not insider"; }
      }
    }
    if (show) visible++; else hidden++;
    console.log(`  [${show ? "✓" : "✗"}] ${e.name} — status=${e.status} vis=${e.visibility} ${e.roundId ? "(league)" : "(standalone)"} — ${reason}`);
  }
  console.log(`\nVisible: ${visible}, Hidden: ${hidden}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
