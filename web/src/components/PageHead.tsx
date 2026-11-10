import type { ReactNode } from "react";
import "./page-head.css";

/**
 * The one page head every tab shares (spec section 6): an optional crumb, the title, at most one computed
 * sentence, and an optional aside that sits at the right of the title row from 1100px and under the sentence below
 * that. 24px from the site header, on the site's gutters, so the left edge and title size match from tab to tab.
 */
export function PageHead({
  title,
  sentence,
  aside,
  crumb,
  className,
}: {
  title: ReactNode;
  sentence?: ReactNode;
  aside?: ReactNode;
  crumb?: ReactNode;
  /** Appended to "page-head", so a page keeps its own overrides local. */
  className?: string;
}) {
  return (
    <header className={className ? `page-head ${className}` : "page-head"}>
      {crumb ? <div className="page-head-crumb">{crumb}</div> : null}
      <h1>{title}</h1>
      {sentence ? <p className="page-head-sentence">{sentence}</p> : null}
      {/* After the sentence in reading order; the grid lifts it onto the title row from 1100px. */}
      {aside ? <div className="page-head-aside">{aside}</div> : null}
    </header>
  );
}
