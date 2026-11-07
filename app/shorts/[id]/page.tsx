import { Suspense } from "react";
import { ShortsSkeleton, ShortsView } from "@/components/shorts/ShortsView";
import { shortPageMetadata } from "@/lib/seo/pages";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A made up id still gets the page, which says the short isn't there.
const startOf = (id: string) => (UUID.test(id) ? id.toLowerCase() : "00000000-0000-4000-8000-000000000000");

export async function generateMetadata({ params }: PageProps<"/shorts/[id]">) {
  return shortPageMetadata(startOf((await params).id));
}

async function DeepLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShortsView startId={startOf(id)} />;
}

// /shorts/<id>: the feed, starting at that short.
export default function ShortPage({ params }: PageProps<"/shorts/[id]">) {
  return (
    <Suspense fallback={<ShortsSkeleton />}>
      <DeepLink params={params} />
    </Suspense>
  );
}
