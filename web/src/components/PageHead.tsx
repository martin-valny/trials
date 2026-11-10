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
}: {
  title: ReactNode;
  sentence?: ReactNode;
  aside?: ReactNode;
  crumb?: ReactNode;
}) {
  return (
    <header className="page-head">
      {crumb ? <div className="page-head-crumb">{crumb}</div> : null}
      <h1>{title}</h1>
      {aside ? <div className="page-head-aside">{aside}</div> : null}
      {sentence ? <p className="page-head-sentence">{sentence}</p> : null}
    </header>
  );
}
