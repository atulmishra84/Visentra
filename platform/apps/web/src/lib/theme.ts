export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "visentra-theme";
const LEGACY_STORAGE_KEY = "agentradar-theme";

export function getStoredTheme(): ThemeMode | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    /* ignore */
  }
  return null;
}

export function getPreferredTheme(): ThemeMode {
  const stored = getStoredTheme();
  if (stored) return stored;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function applyTheme(theme: ThemeMode): void {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  const next: ThemeMode = current === "light" ? "dark" : "light";
  applyTheme(next);
  return next;
}

export function initTheme(): ThemeMode {
  const theme = getPreferredTheme();
  applyTheme(theme);
  return theme;
}
