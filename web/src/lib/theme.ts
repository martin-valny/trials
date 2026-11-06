import { useCallback, useEffect, useSyncExternalStore } from "react";

/** What the reader picked; "system" follows the OS colour scheme. */
export type ThemeChoice = "system" | "light" | "dark";
/** What is actually painted. */
export type Theme = "light" | "dark";

const KEY = "trialradar.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

const isChoice = (v: unknown): v is ThemeChoice => CHOICES.includes(v as ThemeChoice);

/** The stored choice; anything unreadable or unknown is "system". */
export function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return isChoice(v) ? v : "system";
  } catch {
    return "system";
  }
}

/** Stores the choice; storage being unavailable (private mode, quota) is not an error. */
export function writeChoice(c: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, c);
  } catch {
    /* the choice still applies for this visit */
  }
}

export function resolveTheme(c: ThemeChoice, systemDark: boolean): Theme {
  return c === "system" ? (systemDark ? "dark" : "light") : c;
}

/** system -> light -> dark -> system. */
export function nextChoice(c: ThemeChoice): ThemeChoice {
  return CHOICES[(CHOICES.indexOf(c) + 1) % CHOICES.length];
}

// One shared store, so the header switch and Explore's palette always agree.
let current: ThemeChoice | null = null;
const listeners = new Set<() => void>();

const getChoice = (): ThemeChoice => (current ??= readChoice());
const subscribeChoice = (onChange: () => void) => {
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
};

const hasMatchMedia = () => typeof window !== "undefined" && typeof window.matchMedia === "function";
const getSystemDark = () => hasMatchMedia() && window.matchMedia(DARK_QUERY).matches;
const subscribeSystem = (onChange: () => void) => {
  if (!hasMatchMedia()) return () => undefined;
  const m = window.matchMedia(DARK_QUERY);
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
};

const apply = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
};

export function useTheme(): { choice: ThemeChoice; theme: Theme; setChoice(c: ThemeChoice): void } {
  const choice = useSyncExternalStore(subscribeChoice, getChoice, () => "system" as const);
  const systemDark = useSyncExternalStore(subscribeSystem, getSystemDark, () => false);
  const theme = resolveTheme(choice, systemDark);

  useEffect(() => apply(theme), [theme]);

  const setChoice = useCallback((c: ThemeChoice) => {
    current = c;
    writeChoice(c);
    apply(resolveTheme(c, getSystemDark()));
    listeners.forEach((l) => l());
  }, []);

  return { choice, theme, setChoice };
}
