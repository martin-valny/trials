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

/** True when a selector names the class as a whole token: ".tick" matches ".tick" and "g.tick text", not ".ticker". */
const hasClass = (selector: string, cls: string): boolean =>
  new RegExp(`${cls.replace(/[.-]/g, "\\$&")}(?![\\w-])`).test(selector);

/** True when every selector in the list ends on a form field (input, textarea or select): iOS zooms on focus below 16px. */
const onTextField = (selector: string): boolean =>
  selector.split(",").every((s) => /(^|[\s>+~])(input|textarea|select)(\[[^\]]*\]|:[\w-]+)*\s*$/.test(s.trim()));

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
            if (n === 11 && ALLOWED_11.some((s) => hasClass(selector, s))) continue;
          }
          // rem/em only as a scale step (×16); 1rem (16px) only on a text field, where it stops iOS zooming on focus.
          const rel = /^(\d*\.?\d+)r?em$/.exec(v);
          if (rel) {
            const n = Number(rel[1]);
            if (SCALE.has(n * 16)) continue;
            if (v === "1rem" && onTextField(selector)) continue;
          }
          if (v === "inherit") continue;
          bad.push(`${path.split("/src/")[1]}: ${selector.trim().slice(-50)} { font-size: ${v} }`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("matches allowed classes as whole tokens", () => {
    expect(hasClass(".pipe g.tick text", ".tick")).toBe(true);
    expect(hasClass(".ticker", ".tick")).toBe(false);
    expect(hasClass(".tick-label", ".tick")).toBe(false);
    expect(hasClass(".rk-axis", ".axis")).toBe(false);
    expect(onTextField(".tb-find input")).toBe(true);
    expect(onTextField(".dg-form textarea")).toBe(true);
    expect(onTextField(".pair-picker select")).toBe(true);
    expect(onTextField(".nav-sheet a")).toBe(false);
  });

  it("reads no legacy token", () => {
    const legacy = /var\(--(bg|fg|accent|card|warn-bg|warn-fg|ok|line)\)/;
    expect(files.filter((f) => legacy.test(f.css)).map((f) => f.path)).toEqual([]);
  });
});
