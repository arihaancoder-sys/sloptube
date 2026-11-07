import { Suspense } from "react";
import { StudioNav } from "@/components/studio/StudioNav";
import { getCurrentUser } from "@/lib/auth";
import { statsOn } from "@/lib/stats/server";
import { studioOn } from "@/lib/studio/server";

/** The left nav, only while the studio flag is on. Off, every /studio page looks as it did before. */
async function NavGate() {
  if (!(await studioOn())) return null;
  const [user, stats] = await Promise.all([getCurrentUser(), statsOn()]);
  return (
    <StudioNav
      statsOn={stats}
      channel={{
        name: user?.displayName || user?.username || "Your channel",
        handle: user?.channelHandle ?? null,
        avatarUrl: user?.avatarUrl ?? null,
      }}
    />
  );
}

export default function StudioLayout({ children }: LayoutProps<"/studio">) {
  return (
    <div className="tab:flex">
      <Suspense fallback={null}>
        <NavGate />
      </Suspense>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
