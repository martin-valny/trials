/* global URL, console */
// Regenerates web/tests/fixtures/diligence/<target>__<disease>.json from the agent's synthetic recording.
// Usage: node scripts/extract-diligence-fixture.mjs
import { readFileSync, writeFileSync } from "node:fs";
const src = new URL("../../agent/tests/fixtures/recordings/synthetic.jsonl", import.meta.url);
const lines = readFileSync(src, "utf-8").trim().split("\n");
const last = JSON.parse(lines[lines.length - 1]);
if (last.kind !== "result") throw new Error("last line is not a result");
const r = last.record;
const out = new URL(`../tests/fixtures/diligence/${r.target}__${r.disease}.json`, import.meta.url);
writeFileSync(out, JSON.stringify(r, null, 2) + "\n");
console.log("wrote", out.pathname);
