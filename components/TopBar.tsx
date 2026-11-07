import { Suspense } from "react";
import { GuideButton } from "./GuideButton";
import { Logo } from "./Logo";
import { SearchBox, SearchBoxFromUrl } from "./SearchBox";
import { TopBarEnd } from "./TopBarEnd";

/** The 56 px top bar: hamburger and logo, centered search, actions on the right. */
export function TopBar() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center bg-surface px-4">
      <div className="flex shrink-0 items-center">
        <GuideButton />
        <Logo />
      </div>
      <Suspense fallback={<SearchBox />}>
        <SearchBoxFromUrl />
      </Suspense>
      <div className="flex shrink-0 items-center gap-2">
        <Suspense fallback={<div className="h-10 w-10" />}>
          <TopBarEnd />
        </Suspense>
      </div>
    </header>
  );
}
