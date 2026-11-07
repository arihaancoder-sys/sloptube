import { Suspense } from "react";
import { StudioHeader, StudioOff, StudioPage } from "@/components/studio/StudioNotices";
import { YapinAnnouncements } from "@/components/studio/YapinAnnouncements";
import { studioOn } from "@/lib/studio/server";
import { yapinErrorText } from "@/lib/yapin/rules";
import { announcements, yapinOn } from "@/lib/yapin/server";

export const metadata = { title: "Settings | sloptube" };

async function SettingsGate() {
  if (!(await studioOn())) return <StudioOff />;
  return (
    <StudioPage>
      <div data-studio-state="settings">
        <StudioHeader title="Settings" />
        <Suspense fallback={null}>
          <Announcements />
        </Suspense>
        <div className="rounded-[2px] bg-surface px-6 py-12 text-center shadow-[0_0_0_1px_var(--divider)]">
          <p className="text-[16px] text-text">Channel settings arrive in a later feature</p>
          <p className="mt-2 text-[14px] text-text-2">
            Upload defaults, permissions and more will live here. The default comments setting is in Comments for now.
          </p>
        </div>
      </div>
    </StudioPage>
  );
}

/** Yapin' announcements, with the yapin flag on (feature 16). */
async function Announcements() {
  if (!(await yapinOn())) return null;
  const state = await announcements();
  if ("error" in state) {
    return (
      <p data-yapin-announcements="error" className="mb-4 rounded-[2px] bg-surface px-6 py-4 text-[14px] text-text-2 shadow-[0_0_0_1px_var(--divider)]">
        Yapin&apos; announcements: {yapinErrorText(state.error)}
      </p>
    );
  }
  return (
    <div className="mb-4">
      <YapinAnnouncements initial={state} />
    </div>
  );
}

export default function StudioSettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsGate />
    </Suspense>
  );
}
