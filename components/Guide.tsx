"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, Suspense, useContext, type ComponentType } from "react";
import { mainGuide, railGuide, youGuide, type GuideKey } from "@/lib/guide";
import { useFlag, useSession } from "@/lib/store/session";
import { useUi } from "@/lib/store/ui";
import { GuideFooterLinks } from "./launch/SiteFooter";
import { GuideButton } from "./GuideButton";
import { GuideSubscriptions } from "./subscriptions/GuideSubscriptions";
import { SubscriptionsSync } from "./subscriptions/SubscriptionsSync";
import {
  AccountCircleIcon,
  HistoryIcon,
  HomeIcon,
  LibraryIcon,
  SnipsIcon,
  SubscriptionsIcon,
  TrendingIcon,
} from "./icons";
import { Logo } from "./Logo";

type Item = { href: string; label: string; Icon: ComponentType<{ className?: string }> };

// Every link the guide can show. Which ones do show comes from lib/guide.ts
// (feature 18): each appears when its feature's flag goes on.
const ITEMS: Record<GuideKey, Item> = {
  home: { href: "/", label: "Home", Icon: HomeIcon },
  shorts: { href: "/shorts", label: "Snips", Icon: SnipsIcon },
  trending: { href: "/trending", label: "Trending", Icon: TrendingIcon },
  subscriptions: { href: "/feed/subscriptions", label: "Subscriptions", Icon: SubscriptionsIcon },
  library: { href: "/library", label: "Library", Icon: LibraryIcon },
  history: { href: "/feed/history", label: "History", Icon: HistoryIcon },
};

function useShellFlags() {
  return {
    feed: useFlag("feed"),
    shorts: useFlag("shorts"),
    subscriptions: useFlag("subscriptions"),
    engagement: useFlag("engagement"),
  };
}

// The current path, for the active highlight. usePathname() is runtime data on
// dynamic routes (like /@handle), so it is read once inside a <Suspense>
// boundary below and handed down; the fallback renders with no highlight.
const PathContext = createContext<string | null>(null);

function GuideLink({ item, onClick }: { item: Item; onClick?: () => void }) {
  const active = useContext(PathContext) === item.href;
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex h-10 items-center px-6 text-[14px] ${
        active ? "bg-active font-medium" : "hover:bg-hover"
      }`}
    >
      <item.Icon className={`mr-6 h-6 w-6 shrink-0 ${active ? "text-[var(--mark)]" : "text-icon"}`} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-divider py-3">{children}</div>;
}

/** The full 240 px guide content, shared by the docked guide and the drawer. */
function GuideContent({ onNavigate }: { onNavigate?: () => void }) {
  const user = useSession((s) => s.user);
  const loaded = useSession((s) => s.loaded);
  const accounts = useFlag("accounts");
  const flags = useShellFlags();
  const subscriptions = flags.subscriptions;
  const you = youGuide(flags);

  return (
    <>
      <Section>
        {mainGuide(flags).map((key) => (
          <GuideLink key={key} item={ITEMS[key]} onClick={onNavigate} />
        ))}
      </Section>
      {you.length > 0 && (
        <Section>
          {you.map((key) => (
            <GuideLink key={key} item={ITEMS[key]} onClick={onNavigate} />
          ))}
        </Section>
      )}

      {loaded && !user && accounts && (
        <Section>
          <div className="px-8 py-1">
            <p className="text-[14px] leading-5 text-text">
              Sign in to like videos, comment, and subscribe.
            </p>
            <Link
              href="/login"
              onClick={onNavigate}
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-[2px] border border-[var(--link)] px-[11px] text-[14px] font-medium uppercase text-[var(--link)]"
            >
              <AccountCircleIcon className="h-6 w-6" />
              Sign in
            </Link>
          </div>
        </Section>
      )}

      {user && subscriptions && (
        <Section>
          <GuideSubscriptions onNavigate={onNavigate} />
        </Section>
      )}

      <GuideFooterLinks />
      <p className="px-6 py-4 text-[12px] leading-[18px] text-text-3">
        sloptube is built in the open.{" "}
        <a href="https://github.com/myfilehero/sloptube" className="hover:underline">
          Source on GitHub
        </a>
        . MIT license.
      </p>
    </>
  );
}

/** The 72 px icon rail with tiny labels. */
function MiniGuide() {
  const pathname = useContext(PathContext);
  const rail = railGuide(useShellFlags()).map((key) => ITEMS[key]);
  return (
    <nav aria-label="Guide" className="sticky top-14 h-[calc(100dvh-56px)] w-[72px] shrink-0 bg-surface">
      {rail.map(({ href, label, Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="flex flex-col items-center pb-[14px] pt-4 hover:bg-hover"
          >
            <Icon className={`h-6 w-6 ${active ? "text-[var(--mark)]" : "text-icon"}`} />
            <span className="mt-1.5 max-w-full truncate px-1 text-[10px] leading-[14px] text-text">
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The left guide, laid out like 2019 YouTube:
 * - from 1313 px: the full 240 px guide, the hamburger folds it into the icon rail
 * - from 792 px: the icon rail, the hamburger opens the full guide as a drawer
 * - below that: only the drawer
 */
export function Guide() {
  return (
    <>
      <SubscriptionsSync />
      <Suspense fallback={<GuideLayout />}>
        <GuideWithPath />
      </Suspense>
    </>
  );
}

function GuideWithPath() {
  const pathname = usePathname();
  return (
    <PathContext.Provider value={pathname}>
      <GuideLayout />
    </PathContext.Provider>
  );
}

function GuideLayout() {
  const guideMini = useUi((s) => s.guideMini);
  const drawerOpen = useUi((s) => s.drawerOpen);
  const close = useUi((s) => s.closeDrawer);
  // The 2019 watch page has no docked guide: the hamburger opens the drawer.
  // Neither has the creator studio, which brings its own left nav.
  const studioNav = useUi((s) => s.studioNav);
  const docked = useContext(PathContext) !== "/watch" && !studioNav;

  return (
    <>
      <div className={docked ? `hidden tab:block ${guideMini ? "" : "wide:hidden"}` : "hidden"}>
        <MiniGuide />
      </div>

      <nav
        aria-label="Guide"
        className={`sticky top-14 hidden h-[calc(100dvh-56px)] w-60 shrink-0 overflow-y-auto bg-surface ${
          guideMini || !docked ? "" : "wide:block"
        }`}
      >
        <GuideContent />
      </nav>

      {drawerOpen && (
        <div className="fixed inset-0 z-50">
          <div onClick={close} aria-hidden className="absolute inset-0 bg-black/50" />
          <nav
            aria-label="Guide"
            className="absolute inset-y-0 left-0 w-60 overflow-y-auto bg-surface"
          >
            <div className="flex h-14 items-center pl-4">
              <GuideButton />
              <Logo onClick={close} />
            </div>
            <GuideContent onNavigate={close} />
          </nav>
        </div>
      )}
    </>
  );
}
