import { PrismaClient } from "@prisma/client";
import { runTicketmasterIngestion } from "./src/lib/ticketmasterIngest.js";

// Loop until a full pass produces no new writes — that is "backfill done".
async function main() {
  const prisma = new PrismaClient();
  const totals = { fetched: 0, created: 0, matched: 0, updated: 0, needsReview: 0, errors: 0,
    skipped: { duplicateInBatch: 0, missingArtist: 0, missingVenue: 0, invalidDate: 0, unchanged: 0, writeBudgetReached: 0 } };
  let pass = 0;
  for (;;) {
    pass++;
    const s = await runTicketmasterIngestion({
      prisma, now: () => new Date(), allSlices: true,
      maxWrites: 100000, budgetSeconds: 100000,   // no cap locally
    });
    totals.fetched = s.fetched; // last full pass is the true "fetched"
    totals.created += s.created; totals.matched += s.matched; totals.updated += s.updated;
    totals.needsReview += s.needsReview; totals.errors += s.errors;
    for (const k of Object.keys(s.skipped) as (keyof typeof s.skipped)[]) totals.skipped[k] += s.skipped[k];
    const work = s.created + s.matched + s.updated;
    console.log(`pass ${pass}: created=${s.created} matched=${s.matched} updated=${s.updated} unchanged=${s.skipped.unchanged} errors=${s.errors}`);
    if (work === 0) { console.log("CONVERGED — a full pass produced no new writes"); break; }
    if (pass >= 12) { console.log("stopping after 12 passes"); break; }
  }
  console.log("CUMULATIVE:", JSON.stringify(totals));
  await prisma.$disconnect();
}
main();
