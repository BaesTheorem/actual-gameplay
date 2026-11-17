// Write web/tests/fixtures/runner-tracks-v2.json: runs 1 to 30 as the generator makes them.
//   npx tsx scripts/runner-fixture.ts
// The test compares the generator against this file, so it is written again only when the
// rules, the bots or the tier tables are changed on purpose.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RunnerGenerator } from "../src/sim/runner";

export const FIXTURE_RUNS = 30;
export const fixture = () => Array.from({ length: FIXTURE_RUNS }, (_, level) => RunnerGenerator.makeTrack(level));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = fileURLToPath(new URL("../tests/fixtures/runner-tracks-v2.json", import.meta.url));
  writeFileSync(file, JSON.stringify(fixture(), null, 1) + "\n");
  console.log(`wrote ${FIXTURE_RUNS} tracks to ${file}`);
}
