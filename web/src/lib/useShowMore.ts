import { useState } from "react";

/** Rows shown at first, and added by each "Show N more" (DESIGN.md's show-more pattern). */
export const PAGE = 50;

/**
 * Show the first PAGE rows, more on demand. `key` identifies the current query (filters, sort, scope):
 * when it changes the count starts over, with no effect and no extra render.
 */
export function useShowMore(key: string, total: number) {
  const [page, setPage] = useState({ key, limit: PAGE });
  const limit = page.key === key ? page.limit : PAGE;
  const visible = Math.min(limit, total);
  return {
    /** How many rows to render. */
    visible,
    /** How many the next click adds (0 = nothing left). */
    more: Math.min(PAGE, total - visible),
    showMore: () => setPage({ key, limit: limit + PAGE }),
  };
}
