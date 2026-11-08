import type { MarkState, PipelineMark } from "../../types";

interface Props {
  m: PipelineMark;
  /** The state to draw (the page applies the R21 rule for the disease or column in view). */
  state: MarkState;
  /** The company lens is on and this trial is the company's. */
  hit?: boolean;
  size?: 8 | 6 | 4 | 3.5;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  onEnter?: (e: React.MouseEvent<HTMLElement>) => void;
  onLeave?: () => void;
}

/** One trial: a dot in one of five styles; a tail to the left when the trial spans two phases. */
export function Mark({ m, state, hit, size = 8, onClick, onEnter, onLeave }: Props) {
  const cls = ["m", state, m.span ? "cb" : "", hit ? "hit" : "", size === 6 ? "m6" : size === 4 ? "m4" : size === 3.5 ? "m35" : ""].filter(Boolean).join(" ");
  return <i className={cls} data-n={m.n} onClick={onClick} onMouseEnter={onEnter} onMouseLeave={onLeave} />;
}
