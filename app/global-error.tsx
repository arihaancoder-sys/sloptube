"use client";

import "./globals.css";
import { BrokenTv } from "@/components/launch/ErrorPage";
import { themeScript } from "@/lib/theme";

/**
 * When the root layout itself fails: its own document, the same look as the
 * 500 page, in the theme the visitor picked.
 */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <title>Something went wrong | sloptube</title>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full font-sans">
        <main data-error-state="500" className="flex min-h-screen flex-col items-center justify-center bg-page px-6 text-center">
          <BrokenTv />
          <h1 className="mt-6 text-[20px] font-normal text-text">Something went wrong.</h1>
          <p className="mt-2 text-[14px] text-text-2">Sorry about that. Try again in a moment.</p>
          <div className="mt-6 flex gap-2">
            <button type="button" onClick={() => retry()} className="btn-text">
              Try again
            </button>
            {/* A full page load on purpose: the root layout is what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="btn-blue">
              Go home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
