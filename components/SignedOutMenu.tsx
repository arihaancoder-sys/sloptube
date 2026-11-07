"use client";

import { Menu } from "./Menu";
import { MoreIcon } from "./icons";
import { ThemeMenuItem } from "./ThemeMenuItem";

/** The three dot settings menu shown to signed out visitors. */
export function SignedOutMenu() {
  return (
    <Menu label="Settings" button={<MoreIcon className="h-6 w-6" />}>
      {() => <ThemeMenuItem />}
    </Menu>
  );
}
