"use client";

import { useEffect } from "react";
import { useUi } from "@/lib/store/ui";
import { MenuItem } from "./Menu";
import { ChevronRightIcon, DarkThemeIcon } from "./icons";

/** "Dark theme: On/Off" row, as in the 2019 menu. */
export function ThemeMenuItem() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const syncTheme = useUi((s) => s.syncTheme);
  useEffect(syncTheme, [syncTheme]);

  return (
    <MenuItem
      icon={<DarkThemeIcon className="h-6 w-6" />}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      trailing={<ChevronRightIcon className="h-6 w-6 text-icon" />}
    >
      Dark theme: {theme === "dark" ? "On" : "Off"}
    </MenuItem>
  );
}
