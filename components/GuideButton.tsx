"use client";

import { useUi } from "@/lib/store/ui";
import { MenuIcon } from "./icons";

/** The hamburger in the top bar. */
export function GuideButton() {
  const toggle = useUi((s) => s.toggleGuide);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Guide"
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-icon hover:bg-hover"
    >
      <MenuIcon className="h-6 w-6" />
    </button>
  );
}
