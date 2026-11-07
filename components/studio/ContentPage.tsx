import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { statsOn } from "@/lib/stats/server";
import { studioContent } from "@/lib/studio/server";
import { ContentView } from "./ContentView";
import { PreviewNotice, StudioHeader, StudioNoDb, StudioNotSetUp, StudioOff, StudioPage } from "./StudioNotices";

async function ContentGate({ trash }: { trash: boolean }) {
  const [state, stats] = await Promise.all([studioContent(trash), statsOn()]);
  switch (state.kind) {
    case "off":
      return <StudioOff />;
    case "no-db":
      return <StudioNoDb />;
    case "not-set-up":
      return <StudioNotSetUp />;
    case "signed-out":
      redirect(`/login?next=${trash ? "/studio/content/trash" : "/studio/content"}`);
    case "ready":
      return (
        <StudioPage wide>
          <div data-studio-state="ready">
            {state.preview && <PreviewNotice />}
            <StudioHeader title="Channel content">
              <Link href="/upload" className="btn-blue">
                Upload videos
              </Link>
            </StudioHeader>
            {/* useSearchParams in ContentView needs its own boundary. */}
            <Suspense fallback={<ContentSkeleton />}>
              <ContentView rows={state.rows} trash={trash} now={state.now} preview={state.preview} statsOn={stats} />
            </Suspense>
          </div>
        </StudioPage>
      );
  }
}

function ContentSkeleton() {
  return (
    <div aria-hidden className="space-y-3">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-[84px] rounded-[2px] bg-skeleton" />
      ))}
    </div>
  );
}

/** /studio/content and /studio/content/trash. */
export function ContentPage({ trash }: { trash: boolean }) {
  return (
    <Suspense
      fallback={
        <StudioPage wide>
          <ContentSkeleton />
        </StudioPage>
      }
    >
      <ContentGate trash={trash} />
    </Suspense>
  );
}
