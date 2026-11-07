import { ErrorPage } from "@/components/launch/ErrorPage";

export const metadata = { title: "404 Not Found | sloptube", robots: { index: false } };

/** The 2019 "This page isn't available", with a real 404 status. */
export default function NotFound() {
  return (
    <ErrorPage state="404" title="This page isn't available. Sorry about that.">
      Try searching for something else.
    </ErrorPage>
  );
}
