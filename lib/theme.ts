export type Theme = "light" | "dark";

export const THEME_KEY = "sloptube-theme";

/**
 * Runs in <head> before the first paint so a dark theme never flashes white.
 * Kept tiny and dependency free on purpose.
 */
export const themeScript = `try{if(localStorage.getItem("${THEME_KEY}")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode or storage blocked: the theme still applies for this page.
  }
}
