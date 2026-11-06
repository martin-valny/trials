import { nextChoice, useTheme, type ThemeChoice } from "../lib/theme";

const LABEL: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };

/** One quiet text control in the header: click cycles System, Light, Dark. */
export function ThemeSwitch() {
  const { choice, setChoice } = useTheme();
  const label = LABEL[choice];
  return (
    <button
      type="button"
      className="theme-switch"
      data-choice={choice}
      aria-label={`Theme: ${label}`}
      title={`Theme: ${label}. Switch to ${LABEL[nextChoice(choice)]}`}
      onClick={() => setChoice(nextChoice(choice))}
    >
      <span className="theme-switch-key" aria-hidden="true" />
      <span className="theme-switch-k">Theme</span>
      <span className="theme-switch-v">{label}</span>
    </button>
  );
}
