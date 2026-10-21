"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Toaster } from "sonner";

type Theme = "light" | "dark" | "system";

type ThemeContextValue = {
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  resolvedTheme: "light",
  setTheme: () => {},
});

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function storedTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const value = window.localStorage.getItem("theme");
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    typeof window === "undefined" ? "light" : theme === "system" ? systemTheme() : theme
  );

  useEffect(() => {
    const resolved = theme === "system" ? systemTheme() : theme;
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.style.colorScheme = resolved;
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setResolvedTheme(systemTheme());
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);

  const changeTheme = (nextTheme: Theme) => {
    window.localStorage.setItem("theme", nextTheme);
    setResolvedTheme(nextTheme === "system" ? systemTheme() : nextTheme);
    setTheme(nextTheme);
  };

  return (
    <ThemeContext.Provider value={{ resolvedTheme, setTheme: changeTheme }}>
      {children}
      <Toaster position="top-right" richColors closeButton />
    </ThemeContext.Provider>
  );
}
