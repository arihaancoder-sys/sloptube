"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, type ComponentType } from "react";
import { useUi } from "@/lib/store/ui";
import { Avatar } from "../Avatar";
import { AnalyticsIcon, CommentIcon, DashboardIcon, PaletteIcon, SettingsIcon, VideoLibraryIcon } from "../icons";

type Item = { href: string; label: string; Icon: ComponentType<{ className?: string }>; also?: string[]; flag?: "stats" };

export const STUDIO_NAV: Item[] = [
  { href: "/studio", label: "Dashboard", Icon: DashboardIcon },
  { href: "/studio/content", label: "Content", Icon: VideoLibraryIcon, also: ["/studio/video", "/studio/videos"] },
  { href: "/studio/analytics", label: "Analytics", Icon: AnalyticsIcon, flag: "stats" },
  { href: "/studio/comments", label: "Comments", Icon: CommentIcon },
  { href: "/studio/channel", label: "Customization", Icon: PaletteIcon },
  { href: "/studio/settings", label: "Settings", Icon: SettingsIcon },
];

/** The items to show: Analytics only while the stats flag is on. */
export function navItems(statsOn: boolean): Item[] {
  return STUDIO_NAV.filter((item) => !item.flag || (item.flag === "stats" && statsOn));
}

/** Which item a path belongs to: the longest href that matches. A video's analytics page sits under Analytics. */
export function activeItem(path: string | null, statsOn = false): string | null {
  if (!path) return null;
  if (statsOn && /^\/studio\/video\/[^/]+\/analytics$/.test(path)) return "/studio/analytics";
  let best: string | null = null;
  for (const item of navItems(statsOn)) {
    for (const href of [item.href, ...(item.also ?? [])]) {
      const hit = path === href || (href !== "/studio" && path.startsWith(href + "/"));
      if (hit && (!best || href.length > best.length)) best = item.href;
    }
  }
  return best;
}

export type NavChannel = { name: string; handle: string | null; avatarUrl: string | null };

function Items({ active, row, statsOn }: { active: string | null; row?: boolean; statsOn: boolean }) {
  return (
    <>
      {navItems(statsOn).map(({ href, label, Icon }) => {
        const on = active === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? "page" : undefined}
            data-studio-nav-item={label}
            className={
              row
                ? `flex h-12 shrink-0 items-center gap-2 border-b-[3px] px-3 text-[13px] font-medium uppercase ${
                    on ? "border-[var(--mark)] text-[var(--studio-nav-text)]" : "border-transparent text-[var(--studio-nav-text-2)]"
                  }`
                : `relative flex h-12 items-center gap-6 px-6 text-[15px] ${
                    on
                      ? "bg-[var(--studio-nav-active)] text-[var(--studio-nav-text)] before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-[var(--mark)]"
                      : "text-[var(--studio-nav-text-2)] hover:bg-[var(--studio-nav-hover)] hover:text-[var(--studio-nav-text)]"
                  }`
            }
          >
            <Icon className={`h-6 w-6 shrink-0 ${on ? "text-[var(--mark)]" : ""}`} />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </>
  );
}

function NavBody({ channel, active, statsOn }: { channel: NavChannel; active: string | null; statsOn: boolean }) {
  const setStudioNav = useUi((s) => s.setStudioNav);
  useEffect(() => {
    setStudioNav(true);
    return () => setStudioNav(false);
  }, [setStudioNav]);

  return (
    <>
      {/* Tablets and up: the 2020 Studio column. */}
      <nav
        aria-label="Studio"
        data-studio-nav
        className="sticky top-14 hidden h-[calc(100dvh-56px)] w-[255px] shrink-0 overflow-y-auto bg-[var(--studio-nav)] tab:block"
      >
        <div className="flex flex-col items-center px-6 pb-4 pt-6 text-center">
          {channel.handle ? (
            <Link href={`/@${channel.handle}`} title="View channel on sloptube">
              <Avatar name={channel.name} url={channel.avatarUrl} size={112} />
            </Link>
          ) : (
            <Avatar name={channel.name} url={channel.avatarUrl} size={112} />
          )}
          <p className="mt-4 text-[15px] font-medium leading-5 text-[var(--studio-nav-text)]">Your channel</p>
          <p className="mt-0.5 max-w-full truncate text-[13px] text-[var(--studio-nav-text-2)]">{channel.name}</p>
        </div>
        <Items active={active} statsOn={statsOn} />
      </nav>
      {/* Phones: the same items as a strip under the top bar. */}
      <nav
        aria-label="Studio"
        data-studio-nav-row
        className="flex overflow-x-auto bg-[var(--studio-nav)] px-1 [scrollbar-width:none] tab:hidden"
      >
        <Items active={active} row statsOn={statsOn} />
      </nav>
    </>
  );
}

function WithPath({ channel, statsOn }: { channel: NavChannel; statsOn: boolean }) {
  return <NavBody channel={channel} active={activeItem(usePathname(), statsOn)} statsOn={statsOn} />;
}

/** The creator studio's dark left nav: Dashboard, Content, Analytics (with the stats flag), Comments, Customization, Settings. */
export function StudioNav({ channel, statsOn = false }: { channel: NavChannel; statsOn?: boolean }) {
  return (
    <Suspense fallback={<NavBody channel={channel} active={null} statsOn={statsOn} />}>
      <WithPath channel={channel} statsOn={statsOn} />
    </Suspense>
  );
}
