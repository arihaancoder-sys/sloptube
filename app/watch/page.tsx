import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { ChannelMessage } from "@/components/channel/ChannelNotices";
import { CommentsSection, CommentsUnavailable } from "@/components/comments/CommentsSection";
import { ErrorIcon } from "@/components/icons";
import { WatchProcessing } from "@/components/processing/WatchProcessing";
import { Player } from "@/components/watch/Player";
import { UpNext } from "@/components/watch/UpNext";
import { VideoInfo } from "@/components/watch/VideoInfo";
import { WatchLayout } from "@/components/watch/WatchLayout";
import { WatchSkeleton } from "@/components/watch/WatchSkeleton";
import { WatchStub } from "@/components/watch/WatchStub";
import { jsonLdText, videoJsonLd } from "@/lib/seo/meta";
import { siteOrigin } from "@/lib/seo/origin";
import { seoVideo, watchPageMetadata } from "@/lib/seo/pages";
import { parseStart } from "@/lib/watch/format";
import { watchPageState } from "@/lib/watch/server";
import type { WatchVideo } from "@/lib/watch/types";

/** Title, description, canonical link and share cards from the same state the page shows. */
export async function generateMetadata({ searchParams }: PageProps<"/watch">): Promise<Metadata> {
  const v = (await searchParams).v;
  return watchPageMetadata(typeof v === "string" ? v : null);
}

/** schema.org VideoObject for search engines, on public videos only. */
async function VideoJsonLd({ video }: { video: WatchVideo }) {
  if (video.visibility !== "public") return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(videoJsonLd(seoVideo(video), await siteOrigin())) }} />;
}

/** The black 16:9 area with a message in it, where the player would be. */
function PlayerMessage({ title, children, spinner = false }: { title: string; children?: ReactNode; spinner?: boolean }) {
  return (
    <div className="grid h-full w-full place-items-center bg-black p-6 text-center">
      <div>
        {spinner ? (
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-[#555] border-t-white" />
        ) : (
          <ErrorIcon className="mx-auto mb-3 h-12 w-12 text-[#909090]" />
        )}
        <p className="text-[18px] text-white">{title}</p>
        {children && <p className="mt-1 text-[13px] text-[#aaaaaa]">{children}</p>}
      </div>
    </div>
  );
}

/** A message in the player area, with the title under it when there is one. */
function MessageLayout({ state, box, title }: { state: string; box: ReactNode; title?: string }) {
  return (
    <div data-watch-state={state}>
      <WatchLayout
        player={box}
        info={title ? <h1 className="px-3 pt-3 text-[18px] leading-[26px] text-text tab:px-0 tab:pt-5">{title}</h1> : null}
        side={null}
      />
    </div>
  );
}

async function Watch({ searchParams }: { searchParams: PageProps<"/watch">["searchParams"] }) {
  const params = await searchParams;
  const v = typeof params.v === "string" ? params.v : null;
  const t = typeof params.t === "string" ? params.t : null;
  const state = await watchPageState(v);

  switch (state.kind) {
    case "off":
      return (
        <div data-watch-state="off">
          <WatchStub v={v} />
        </div>
      );
    case "no-db":
      return (
        <div data-watch-state="no-db">
          <ChannelMessage state="no-db" title="database not connected">
            Add the publishable key to <code>.env.local</code> (see <code>.env.example</code>) and restart to watch videos.
          </ChannelMessage>
        </div>
      );
    case "not-set-up":
      return (
        <div data-watch-state="not-set-up">
          <ChannelMessage state="not-set-up" title="The watch page isn't set up yet">
            Run <code>supabase/migrations/007_watch.sql</code> in the Supabase SQL editor.
          </ChannelMessage>
        </div>
      );
    case "missing":
      return (
        <MessageLayout
          state="missing"
          box={<PlayerMessage title="Video unavailable">This video is private, or the link is wrong.</PlayerMessage>}
        />
      );
    case "processing":
      return (
        <MessageLayout
          state="processing"
          title={state.title}
          box={
            <PlayerMessage title="This video is being processed" spinner>
              Check back in a few minutes.
            </PlayerMessage>
          }
        />
      );
    case "owner-processing": {
      const { video, live, processingOn } = state;
      const failed = live.status === "failed";
      const box = failed ? (
        <PlayerMessage title="This upload failed">Only you see this. Upload the file again from /upload.</PlayerMessage>
      ) : processingOn ? (
        <div className="grid h-full w-full place-items-center bg-black text-center">
          <WatchProcessing video={live} />
        </div>
      ) : (
        <PlayerMessage title="Processing" spinner>
          Only you see this. Check back in a few minutes.
        </PlayerMessage>
      );
      return (
        <div data-watch-state="owner-processing" data-status={live.status}>
          <WatchLayout player={box} info={<VideoInfo video={video} />} side={<UpNext videos={[]} channel={video.channel} />} />
        </div>
      );
    }
    case "ready": {
      const { video, upNext, preview, engagement, comments } = state;
      return (
        <div data-watch-state="ready" data-preview={preview ? "1" : undefined}>
          {!preview && <VideoJsonLd video={video} />}
          <WatchLayout
            player={
              <Player
                key={video.id}
                videoId={video.id}
                src={video.src}
                poster={video.thumbnail}
                spriteVtt={video.spriteVtt}
                durationS={video.durationS}
                startAt={parseStart(t)}
                engagement={engagement}
              />
            }
            info={<VideoInfo video={video} engagement={engagement} />}
            side={<UpNext videos={upNext} channel={video.channel} />}
            comments={
              comments === "no-db" ? (
                <CommentsUnavailable />
              ) : comments ? (
                <CommentsSection
                  key={video.id}
                  videoId={video.id}
                  initial={comments}
                  channel={{ name: video.channel.name, avatarUrl: video.channel.avatarUrl }}
                />
              ) : null
            }
          />
        </div>
      );
    }
  }
}

export default function WatchPage({ searchParams }: PageProps<"/watch">) {
  return (
    <Suspense
      fallback={<WatchSkeleton />}
    >
      <Watch searchParams={searchParams} />
    </Suspense>
  );
}
