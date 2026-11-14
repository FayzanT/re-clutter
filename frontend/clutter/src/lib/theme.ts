"use client";

import { useSyncExternalStore } from "react";

const THEME_KEY = "clutter-theme";
const THEME_EVENT = "clutter-theme-change";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function subscribe(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {
      /* Storage may be disabled. */
    }
    if (saved !== "light" && saved !== "dark") {
      applyTheme(media.matches ? "dark" : "light");
      callback();
    }
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_KEY && event.key !== null) return;
    applyTheme(
      event.newValue === "dark" || (event.newValue !== "light" && media.matches)
        ? "dark"
        : "light",
    );
    callback();
  };
  window.addEventListener(THEME_EVENT, callback);
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", onSystemChange);
  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onSystemChange);
  };
}

const getSnapshot = (): Theme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";
const getServerSnapshot = (): Theme => "light";

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggleTheme = () => {
    const next = getSnapshot() === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* The choice still works for this session. */
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  };
  return { theme, toggleTheme };
}
