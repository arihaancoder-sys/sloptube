"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFlag, type SessionUser } from "@/lib/store/session";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "./Avatar";
import { ChannelIcon, SettingsIcon, SignOutIcon } from "./icons";
import { Menu, MenuDivider, MenuItem } from "./Menu";
import { ThemeMenuItem } from "./ThemeMenuItem";

/** The avatar in the top bar and its menu, 2019 style. */
export function AvatarMenu({ user, email }: { user: SessionUser; email: string | null }) {
  const router = useRouter();
  const channels = useFlag("channels");

  async function signOut() {
    await createClient()?.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <Menu label="Account menu" button={<Avatar name={user.displayName} url={user.avatarUrl} size={32} />}>
      {(close) => (
        <>
          <div className="flex gap-4 px-4 pb-4 pt-2">
            <Avatar name={user.displayName} url={user.avatarUrl} size={40} />
            <div className="min-w-0">
              <p className="truncate text-[16px] font-medium leading-[22px] text-text">{user.displayName}</p>
              <p className="truncate text-[14px] leading-5 text-text-2">@{user.username}</p>
              {email && <p className="truncate text-[14px] leading-5 text-text-2">{email}</p>}
              <Link href="/settings" onClick={close} className="mt-2 inline-block text-[14px] text-[var(--link)]">
                Manage your account
              </Link>
            </div>
          </div>
          <MenuDivider />
          {channels && user.channelHandle && (
            <MenuItem
              icon={<ChannelIcon className="h-6 w-6" />}
              onClick={() => {
                close();
                router.push(`/@${user.channelHandle}`);
              }}
            >
              Your channel
            </MenuItem>
          )}
          <MenuItem
            icon={<SettingsIcon className="h-6 w-6" />}
            onClick={() => {
              close();
              router.push("/settings");
            }}
          >
            Settings
          </MenuItem>
          <ThemeMenuItem />
          <MenuItem
            icon={<SignOutIcon className="h-6 w-6" />}
            onClick={() => {
              close();
              void signOut();
            }}
          >
            Sign out
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
