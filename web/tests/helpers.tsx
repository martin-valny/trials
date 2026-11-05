import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

export const DATA = join(__dirname, "fixtures", "data");

export function readFixture<T>(path: string): T {
  return JSON.parse(readFileSync(join(DATA, path), "utf-8")) as T;
}

/** Serve fixture files for /data/... URLs; ``overrides`` maps a path to a body or a status. */
export function stubFetch(overrides: Record<string, unknown | number> = {}) {
  const fn = vi.fn(async (url: string) => {
    const path = String(url).replace(/^.*\/data\//, "");
    const o = overrides[path];
    if (typeof o === "number") return new Response("", { status: o });
    if (o !== undefined) return new Response(JSON.stringify(o), { status: 200 });
    try {
      return new Response(readFileSync(join(DATA, path), "utf-8"), { status: 200 });
    } catch {
      return new Response("", { status: 404 });
    }
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

export const renderAt = (ui: ReactElement, route = "/") =>
  render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
