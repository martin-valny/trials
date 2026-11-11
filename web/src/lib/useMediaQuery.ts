import { useCallback, useSyncExternalStore } from "react";

/** Live value of a CSS media query; false where matchMedia is unavailable. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

/** True at phone width (the CSS breakpoint at 640px); false where matchMedia is missing (tests). */
export const usePhone = (): boolean => useMediaQuery("(max-width: 640px)");
