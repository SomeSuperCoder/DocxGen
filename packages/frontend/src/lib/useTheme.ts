import { useEffect, useState } from "react";
type Theme = "light" | "dark";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const followSystem = () => {
      try {
        const saved = localStorage.getItem("docxgen-theme");
        if (saved === "light" || saved === "dark") return;
      } catch {
        /* Storage is optional. */
      }
      setTheme(media.matches ? "dark" : "light");
    };
    followSystem();
    media.addEventListener("change", followSystem);
    return () => media.removeEventListener("change", followSystem);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    try {
      localStorage.setItem("docxgen-theme", next);
    } catch {
      /* Work in private browsing too. */
    }
    setTheme(next);
  };
  return { theme, toggleTheme };
}
