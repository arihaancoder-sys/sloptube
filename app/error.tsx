"use client";

import { useEffect } from "react";
import { ErrorPage } from "@/components/launch/ErrorPage";

/** Anything that throws while a page renders: the 2019 500 page with Try again. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";
  return (
    <ErrorPage
      state="500"
      title="Something went wrong."
      search={false}
      actions={
        <button type="button" onClick={() => retry()} className="btn-text">
          Try again
        </button>
      }
    >
      Sorry about that. Try again in a moment.
      {digest && <p className="mt-2 text-[12px] text-text-3">Error code: {digest}</p>}
    </ErrorPage>
  );
}
