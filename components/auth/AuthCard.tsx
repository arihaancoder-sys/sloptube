import type { ReactNode } from "react";
import { LogoMark } from "../icons";

/** The 2019 sign in card: 450 px, thin grey border, centered logo and heading. */
export function AuthCard({
  title,
  subtitle,
  children,
  wide,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex justify-center px-0 py-0 sm:px-4 sm:py-12">
      <section
        className={`w-full bg-surface px-6 pb-9 pt-12 sm:rounded-lg sm:border sm:border-[#dadce0] sm:px-10 dark:sm:border-divider ${
          wide ? "max-w-[748px]" : "max-w-[450px]"
        }`}
      >
        <div className="flex items-center justify-center gap-1">
          <LogoMark className="h-6 w-[34px]" />
          <span className="text-[24px] font-bold tracking-[-1px] text-red">sloptube</span>
        </div>
        <h1 className="mt-4 text-center text-[24px] font-normal leading-8 text-text">{title}</h1>
        {subtitle && <p className="mt-2 text-center text-[16px] leading-6 text-text">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </section>
    </div>
  );
}

/** Shown in place of a form when the Supabase settings are missing. */
export function DbNotConnected() {
  return (
    <div role="status" className="rounded-sm border border-divider bg-hover px-4 py-3 text-[14px] leading-5 text-text">
      <p className="font-medium">database not connected</p>
      <p className="mt-1 text-text-2">
        Accounts need Supabase. Add the publishable key to <code>.env.local</code> (see{" "}
        <code>.env.example</code>) and restart.
      </p>
    </div>
  );
}

/** Shown when the accounts feature flag is off for this person. */
export function FeatureOff() {
  return (
    <div role="status" className="rounded-sm border border-divider bg-hover px-4 py-3 text-[14px] text-text">
      Accounts are switched off right now. Check back soon.
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div aria-hidden className="space-y-6">
      <div className="h-10 rounded bg-skeleton" />
      <div className="h-12 rounded bg-skeleton" />
      <div className="h-12 rounded bg-skeleton" />
    </div>
  );
}
