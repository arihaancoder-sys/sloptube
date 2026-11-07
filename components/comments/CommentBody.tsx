"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { needsReadMore, READ_MORE_LINES, splitMention } from "@/lib/comments/rules";

/**
 * A comment's text, folded to four lines with "Read more" like 2019. The
 * first guess comes from the text (needsReadMore), then the real height
 * decides once the comment is on screen.
 */
export function CommentBody({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(() => needsReadMore(text, 90));
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (!open) setLong(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);

  const { mention, rest } = splitMention(text);
  return (
    <div data-comment-body={open ? "open" : "closed"}>
      <div
        ref={ref}
        className="whitespace-pre-wrap break-words text-[14px] leading-5 text-text"
        style={open ? undefined : { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: READ_MORE_LINES, overflow: "hidden" }}
      >
        {mention && (
          <Link href={`/${mention}`} className="text-link">
            {mention}
          </Link>
        )}
        {mention ? rest : text}
      </div>
      {(long || open) && (
        <button
          type="button"
          data-read-more
          onClick={() => setOpen(!open)}
          className="mt-1 text-[14px] font-medium leading-5 text-text-2 hover:text-text"
        >
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}
