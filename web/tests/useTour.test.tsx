import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useTour } from "../src/lib/useTour";
import type { ViewKey } from "../src/lib/intro";

const KEYS: ViewKey[] = ["all", "pipeline", "approaches"];
const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
});

test("starts on all and advances 3200 ms, then 4200 ms, back around to all", () => {
  const { result } = renderHook(() => useTour(KEYS, false));
  expect(result.current.active).toBe("all");
  act(() => void vi.advanceTimersByTime(3199));
  expect(result.current.active).toBe("all");
  act(() => void vi.advanceTimersByTime(1));
  expect(result.current.active).toBe("pipeline");
  act(() => void vi.advanceTimersByTime(4199));
  expect(result.current.active).toBe("pipeline");
  act(() => void vi.advanceTimersByTime(1));
  expect(result.current.active).toBe("approaches");
  act(() => void vi.advanceTimersByTime(4200));
  expect(result.current.active).toBe("all");
});

test("hold stops the tour on that view and release resumes it", () => {
  const { result } = renderHook(() => useTour(KEYS, false));
  act(() => result.current.hold("approaches"));
  expect(result.current).toMatchObject({ active: "approaches", held: true });
  act(() => void vi.advanceTimersByTime(20000));
  expect(result.current.active).toBe("approaches");
  act(() => result.current.release());
  expect(result.current.held).toBe(false);
  act(() => void vi.advanceTimersByTime(4200));
  expect(result.current.active).toBe("all");
});

test("reduced motion never advances", () => {
  const { result } = renderHook(() => useTour(KEYS, true));
  act(() => void vi.advanceTimersByTime(60000));
  expect(result.current.active).toBe("all");
});

test("a hidden tab pauses the tour and a visible one resumes it", () => {
  const { result } = renderHook(() => useTour(KEYS, false));
  act(() => setHidden(true));
  act(() => void vi.advanceTimersByTime(60000));
  expect(result.current.active).toBe("all");
  act(() => setHidden(false));
  act(() => void vi.advanceTimersByTime(3200));
  expect(result.current.active).toBe("pipeline");
});
