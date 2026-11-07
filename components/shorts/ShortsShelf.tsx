import { SnipsMark } from "@/components/icons";
import type { Short } from "@/lib/shorts/types";
import { ShortCard } from "./ShortCard";

/**
 * The Snips shelf on the home feed, 2020 style: the red mark and "Snips"
 * over one row of vertical thumbnails that scrolls sideways. It spans every
 * column of the grid (see lib/shorts/shelf.ts for where it sits).
 */
export function ShortsShelf({ shorts }: { shorts: Short[] }) {
  return (
    <section className="col-span-full border-y border-divider py-5 sm:border-y-0 sm:py-0" data-shorts-shelf={shorts.length} aria-labelledby="shorts-shelf-title">
      <h2 id="shorts-shelf-title" className="mb-4 flex items-center gap-2 px-3 text-[20px] font-medium leading-7 text-text sm:px-0">
        <SnipsMark className="h-7 w-7" />
        Snips
      </h2>
      <div className="flex snap-x scroll-px-3 gap-3 overflow-x-auto px-3 pb-2 sm:scroll-px-0 [scrollbar-width:thin] sm:gap-4 sm:px-0">
        {shorts.map((s) => (
          <ShortCard key={s.id} video={s} className="w-[150px] shrink-0 snap-start sm:w-[210px]" />
        ))}
      </div>
    </section>
  );
}
