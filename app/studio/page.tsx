import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Dashboard } from "@/components/studio/Dashboard";
import {
  PreviewNotice,
  StudioHeader,
  StudioNoDb,
  StudioNotSetUp,
  StudioOff,
  StudioPage,
  StudioSkeleton,
} from "@/components/studio/StudioNotices";
import { studioOverview } from "@/lib/studio/server";

export const metadata = { title: "Channel dashboard | sloptube" };

async function DashboardGate() {
  const state = await studioOverview();
  switch (state.kind) {
    case "off":
      return <StudioOff />;
    case "no-db":
      return <StudioNoDb />;
    case "not-set-up":
      return <StudioNotSetUp />;
    case "signed-out":
      redirect("/login?next=/studio");
    case "ready":
      return (
        <StudioPage wide>
          <div data-studio-state="ready">
            {state.preview && <PreviewNotice />}
            <StudioHeader title="Channel dashboard">
              <Link href="/upload" className="btn-blue">
                Upload videos
              </Link>
            </StudioHeader>
            <Dashboard overview={state.overview} />
          </div>
        </StudioPage>
      );
  }
}

export default function StudioDashboardPage() {
  return (
    <Suspense
      fallback={
        <StudioPage wide>
          <StudioSkeleton />
        </StudioPage>
      }
    >
      <DashboardGate />
    </Suspense>
  );
}
