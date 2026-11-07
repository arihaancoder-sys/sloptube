"use client";

import Link from "next/link";
import { PUBLIC_LINKS } from "@/lib/launch/links";
import { useFlag } from "@/lib/store/session";
import { siteConfig } from "@/site.config";

/**
 * The links at the bottom of every page (feature 15), in the small grey
 * 2019 style of the guide's footer. Behind the launch flag.
 */
export function SiteFooter() {
  const on = useFlag("launch");
  if (!on) return null;
  return (
    <footer className="border-t border-divider px-4 py-6 sm:px-6" data-site-footer>
      <nav aria-label="Footer">
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] font-medium leading-5 text-text-2">
          {PUBLIC_LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} prefetch={false} className="hover:text-text">
                {l.label}
              </Link>
            </li>
          ))}
          <li>
            <a href={siteConfig.sourceUrl} className="hover:text-text">
              Source code
            </a>
          </li>
        </ul>
      </nav>
      <p className="mt-2 text-[12px] leading-[18px] text-text-3">
        {siteConfig.siteName} is open source under the MIT license.
      </p>
    </footer>
  );
}

/** The same links in the guide's footer, as in the 2019 left menu. */
export function GuideFooterLinks() {
  const on = useFlag("launch");
  if (!on) return null;
  return (
    <ul className="flex flex-wrap gap-x-2 px-6 pt-4 text-[13px] font-medium leading-[18px] text-text-2" data-guide-footer>
      {PUBLIC_LINKS.map((l) => (
        <li key={l.href}>
          <Link href={l.href} prefetch={false} className="hover:text-text">
            {l.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
