import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".css") ? [p] : [];
  });
}

const files = walk(join(__dirname, "..", "src")).map((path) => ({
  path,
  css: readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""),
}));

const SCALE = new Set([12, 13, 14, 15, 19, 20, 22, 24, 28, 30, 34, 40]);
// 11px is allowed only inside these selectors.
const ALLOWED_11 = [
  ".fam", // front-door family band label (uppercase, tracked)
  ".pfam", // the same band label in the phone list
  ".past", // the "Mostly historical" divider (uppercase, tracked)
  ".tick", // SVG axis tick label
  ".axis", // SVG axis label
  ".numeral", // canvas numeral
  ".years-scale", // year-range axis ticks
  ".rk-axis", // stop-risk scale axis ticks
];

describe("css scale", () => {
  it("uses only scale sizes for text", () => {
    const bad: string[] = [];
    for (const { path, css } of files) {
      for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        for (const [, value] of body.matchAll(/font-size:\s*([^;}]+)/g)) {
          const v = value.trim();
          if (/^var\(--fs-[a-z]+\)$/.test(v) || v.startsWith("clamp(")) continue;
          const px = /^(\d+(?:\.\d+)?)px$/.exec(v);
          if (px) {
            const n = Number(px[1]);
            if (SCALE.has(n)) continue;
            if (n === 11 && ALLOWED_11.some((s) => selector.includes(s))) continue;
          }
          const rem = /^(\d*\.?\d+)rem$/.exec(v);
          if (rem && Number(rem[1]) >= 0.75) continue;
          const em = /^(\d*\.?\d+)em$/.exec(v);
          if (em && Number(em[1]) >= 0.75) continue;
          if (v === "inherit") continue;
          bad.push(`${path.split("/src/")[1]}: ${selector.trim().slice(-50)} { font-size: ${v} }`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("reads no legacy token", () => {
    const legacy = /var\(--(bg|fg|accent|card|warn-bg|warn-fg|ok|line)\)/;
    expect(files.filter((f) => legacy.test(f.css)).map((f) => f.path)).toEqual([]);
  });
});
