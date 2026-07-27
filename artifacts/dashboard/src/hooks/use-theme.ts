import { useCallback, useSyncExternalStore } from "react";

export type Theme = "dark" | "light" | "system";

const STORAGE_KEY = "jarvis-theme";

const listeners = new Set<() => void>();

const media =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

function getTheme(): Theme {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return t === "light" || t === "system" ? t : "dark";
  } catch {
    return "dark";
  }
}

function resolveDark(theme: Theme): boolean {
  if (theme === "system") return media ? media.matches : true;
  return theme !== "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", resolveDark(theme));
}

// React to live OS preference changes while in "system" mode.
media?.addEventListener("change", () => {
  const theme = getTheme();
  if (theme === "system") {
    applyTheme(theme);
    listeners.forEach((l) => l());
  }
});

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "dark" as Theme);

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage failures; theme still applies for this session
    }
    applyTheme(next);
    listeners.forEach((l) => l());
  }, []);

  return { theme, setTheme };
}
