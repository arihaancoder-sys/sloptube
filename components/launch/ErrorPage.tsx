import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The 2019 error page: a broken TV drawing, one line in 20 px, one grey line
 * under it, a search box and the way home. Used by the 404, the 500 and the
 * maintenance page.
 */
export function ErrorPage({
  state,
  title,
  children,
  search = true,
  actions,
}: {
  state: string;
  title: string;
  children?: ReactNode;
  search?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div data-error-state={state} className="flex min-h-[calc(100dvh-56px)] flex-col items-center justify-center bg-page px-6 py-12 text-center">
      <BrokenTv />
      <h1 className="mt-6 text-[20px] font-normal leading-7 text-text">{title}</h1>
      {children && <div className="mt-2 max-w-[480px] text-[14px] leading-5 text-text-2">{children}</div>}
      {search && (
        <form action="/results" method="get" role="search" className="mt-6 flex w-full max-w-[420px]">
          <label htmlFor="error-search" className="sr-only">
            Search
          </label>
          <input
            id="error-search"
            name="search_query"
            placeholder="Search"
            className="h-10 min-w-0 flex-1 rounded-l-[2px] border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-[16px] text-text outline-none focus:border-[var(--focus)]"
          />
          <button type="submit" className="h-10 rounded-r-[2px] border border-l-0 border-[var(--search-btn-border)] bg-[var(--search-btn)] px-5 text-[14px] text-text">
            Search
          </button>
        </form>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {actions}
        <Link href="/" className="btn-blue">
          Go home
        </Link>
      </div>
    </div>
  );
}

/** A small grey TV with a crack and a sad face, drawn here (not the 2019 monkey). */
export function BrokenTv({ className = "h-[120px] w-[160px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden>
      <path d="M58 14 80 30 102 14" fill="none" stroke="var(--text-3)" strokeWidth="4" strokeLinecap="round" />
      <rect x="16" y="30" width="128" height="80" rx="10" fill="var(--skeleton)" stroke="var(--text-3)" strokeWidth="4" />
      <rect x="30" y="42" width="100" height="56" rx="4" fill="var(--surface)" />
      <path d="M92 42 84 58 96 66 86 98" fill="none" stroke="var(--text-3)" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="58" cy="64" r="4" fill="var(--text-2)" />
      <circle cx="74" cy="64" r="4" fill="var(--text-2)" />
      <path d="M56 84c5-6 15-6 20 0" fill="none" stroke="var(--text-2)" strokeWidth="3" strokeLinecap="round" />
      <rect x="30" y="110" width="12" height="6" rx="2" fill="var(--text-3)" />
      <rect x="118" y="110" width="12" height="6" rx="2" fill="var(--text-3)" />
    </svg>
  );
}
