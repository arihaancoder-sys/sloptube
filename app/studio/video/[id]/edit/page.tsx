import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ChannelMessage } from "@/components/channel/ChannelNotices";
import { PreviewNotice, StudioNoDb, StudioNotSetUp, StudioOff, StudioPage } from "@/components/studio/StudioNotices";
import { VideoEditor } from "@/components/studio/VideoEditor";
import { UUID } from "@/lib/studio/http";
import { statsOn } from "@/lib/stats/server";
import { studioVideo } from "@/lib/studio/server";

export const metadata = { title: "Video details | sloptube" };

async function EditGate({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [state, stats] = await Promise.all([studioVideo(id.toLowerCase()), statsOn()]);
  switch (state.kind) {
    case "off":
      return <StudioOff />;
    case "no-db":
      return <StudioNoDb />;
    case "not-set-up":
      return <StudioNotSetUp />;
    case "signed-out":
      redirect(`/login?next=/studio/video/${id}/edit`);
    case "missing":
      return (
        <div data-studio-state="missing">
          <ChannelMessage state="missing" title="This video isn't in your content">
            It may be in the trash, or it belongs to another channel.
          </ChannelMessage>
        </div>
      );
    case "ready":
      return (
        <StudioPage wide>
          <div data-studio-state="ready">
            {state.preview && <PreviewNotice />}
            <VideoEditor
              video={state.video}
              stills={state.stills}
              custom={state.custom}
              channelDefault={state.channelDefault}
              commentsOn={state.commentsOn}
              shortsOn={state.shortsOn}
              uploadsConfigured={state.uploadsConfigured}
              preview={state.preview}
              statsOn={stats}
            />
          </div>
        </StudioPage>
      );
  }
}

export default function StudioEditPage({ params }: PageProps<"/studio/video/[id]/edit">) {
  return (
    <Suspense fallback={<StudioPage wide>{null}</StudioPage>}>
      <EditGate params={params} />
    </Suspense>
  );
}
