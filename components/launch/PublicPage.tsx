import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ChannelMessage } from "@/components/channel/ChannelNotices";
import { PUBLIC_LINKS } from "@/lib/launch/links";
import { launchGate } from "@/lib/launch/server";
import { isPlaceholder, siteConfig } from "@/site.config";

/** A value from site.config.ts; a placeholder still in capitals is marked so it is easy to spot. */
export function Owner({ value }: { value: string }) {
  if (!isPlaceholder(value)) return <>{value}</>;
  return (
    <code className="rounded-[2px] bg-hover px-1 text-[0.92em] text-text" data-placeholder={value} title="Set this in site.config.ts">
      {value}
    </code>
  );
}

/** The contact address as a mailto link, or the marked placeholder. */
export function ContactEmail() {
  const email = siteConfig.contactEmail;
  if (isPlaceholder(email)) return <Owner value={email} />;
  return (
    <a href={`mailto:${email}`} className="text-link hover:underline">
      {email}
    </a>
  );
}

/** A section heading and its text, like the 2019 help and policy pages. */
export function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-8 scroll-mt-20">
      <h2 className="text-[18px] font-normal leading-[26px] text-text">{title}</h2>
      <div className="prose-2019 mt-2">{children}</div>
    </section>
  );
}

async function Gate({ page, children }: { page: string; children: ReactNode }) {
  const gate = await launchGate();
  if (gate !== "on") {
    return (
      <div data-launch-state={gate}>
        <ChannelMessage state={gate} title={gate === "no-db" ? "database not connected" : "This page isn't on yet"}>
          {gate === "no-db" ? (
            <>
              Add the publishable key to <code>.env.local</code> (see <code>.env.example</code>) and restart.
            </>
          ) : (
            <>Check back soon.</>
          )}
        </ChannelMessage>
      </div>
    );
  }
  return (
    <div data-launch-state="on" data-public-page={page}>
      {children}
    </div>
  );
}

/**
 * The layout of /about, /terms, /privacy, /guidelines, /press and /contact:
 * a white sheet on the grey page with a 2019 style header, a tab row of the
 * other public pages and the text. Behind the launch flag.
 */
export function PublicPage({
  page,
  title,
  intro,
  updated = false,
  wide = false,
  children,
}: {
  page: string;
  title: string;
  intro?: ReactNode;
  /** Show "Last updated" from site.config.ts (terms and privacy). */
  updated?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <Suspense fallback={<PublicSkeleton />}>
      <Gate page={page}>
        <div className="min-h-[calc(100dvh-56px)] bg-page">
          <div className={`mx-auto px-0 py-0 sm:px-6 sm:py-6 ${wide ? "max-w-[1100px]" : "max-w-[860px]"}`}>
            <nav aria-label="About sloptube" className="flex overflow-x-auto border-b border-divider bg-surface sm:rounded-t-[2px]">
              {PUBLIC_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={l.href === `/${page}` ? "page" : undefined}
                  className={`flex h-12 shrink-0 items-center border-b-[3px] px-4 text-[14px] font-medium uppercase ${
                    l.href === `/${page}` ? "border-[var(--text-2)] text-text" : "border-transparent text-text-2 hover:text-text"
                  }`}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            <article className="bg-surface px-4 pb-10 pt-6 sm:rounded-b-[2px] sm:px-10 sm:shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
              <h1 className="text-[28px] font-normal leading-9 text-text">{title}</h1>
              {updated && (
                <p className="mt-1 text-[13px] text-text-2">
                  Last updated: <Owner value={siteConfig.legalUpdated} />
                </p>
              )}
              {intro && <div className="mt-3 text-[16px] leading-6 text-text-2">{intro}</div>}
              {children}
            </article>
          </div>
        </div>
      </Gate>
    </Suspense>
  );
}

export function PublicSkeleton() {
  return (
    <div aria-hidden className="mx-auto max-w-[860px] px-4 py-6 sm:px-6">
      <div className="h-12 bg-skeleton" />
      <div className="mt-6 h-8 w-1/2 bg-skeleton" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="mt-4 h-4 w-full bg-skeleton" />
      ))}
    </div>
  );
}
