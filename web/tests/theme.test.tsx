import { afterEach, describe, expect, it, vi } from "vitest";
import { nextChoice, readChoice, resolveTheme, writeChoice } from "../src/lib/theme";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("resolveTheme", () => {
  it("follows the system only when the choice is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("nextChoice", () => {
  it("cycles system -> light -> dark -> system", () => {
    expect(nextChoice("system")).toBe("light");
    expect(nextChoice("light")).toBe("dark");
    expect(nextChoice("dark")).toBe("system");
  });
});

describe("readChoice / writeChoice", () => {
  it("round-trips a stored choice", () => {
    writeChoice("dark");
    expect(localStorage.getItem("trialradar.theme")).toBe("dark");
    expect(readChoice()).toBe("dark");
  });

  it("falls back to system when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readChoice()).toBe("system");
  });

  it("falls back to system for an unknown stored value", () => {
    localStorage.setItem("trialradar.theme", "purple");
    expect(readChoice()).toBe("system");
  });

  it("swallows storage errors on write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeChoice("dark")).not.toThrow();
  });
});

describe("useTheme", () => {
  it("puts data-theme on <html> before any child's effects read the page's colours", async () => {
    const { render, cleanup } = await import("@testing-library/react");
    const { useEffect } = await import("react");
    const { useTheme } = await import("../src/lib/theme");
    document.documentElement.dataset.theme = "light";
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("dark"),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const seen: (string | undefined)[] = [];
    function Child() {
      useEffect(() => void seen.push(document.documentElement.dataset.theme));
      return null;
    }
    function Parent() {
      useTheme();
      return <Child />;
    }
    render(<Parent />);
    expect(seen[0]).toBe("dark");
    cleanup();
    vi.unstubAllGlobals();
  });
});
