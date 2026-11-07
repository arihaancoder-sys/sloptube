"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { BODY_MAX, bodyProblem, cleanBody } from "@/lib/comments/rules";

/**
 * The 2019 comment box: the avatar and an underlined field that grows with
 * the text. The CANCEL and COMMENT buttons show once it has focus (always for
 * replies and edits, which open on purpose).
 */
export function CommentBox({
  avatarName,
  avatarUrl,
  size = 40,
  placeholder = "Add a public comment...",
  submitLabel = "Comment",
  initial = "",
  autoFocus = false,
  alwaysOpen = false,
  onSubmit,
  onCancel,
}: {
  avatarName: string | null;
  avatarUrl?: string | null;
  size?: number;
  placeholder?: string;
  submitLabel?: string;
  initial?: string;
  autoFocus?: boolean;
  alwaysOpen?: boolean;
  /** Answers true when the text was taken (the box then empties and closes). */
  onSubmit: (body: string) => Promise<boolean> | boolean;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [open, setOpen] = useState(alwaysOpen);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  const problem = bodyProblem(text);
  const tooLong = problem === "body_too_long";
  const cancel = () => {
    setText(initial);
    setOpen(alwaysOpen);
    ref.current?.blur();
    onCancel?.();
  };
  const submit = async () => {
    if (problem) return;
    const body = cleanBody(text);
    setText("");
    setOpen(alwaysOpen);
    ref.current?.blur();
    const taken = await onSubmit(body);
    if (!taken) setText(body);
  };

  return (
    <div className="flex items-start gap-4" data-comment-box>
      {avatarName !== null && <Avatar name={avatarName} url={avatarUrl} size={size} />}
      <div className="min-w-0 flex-1">
        <div className={`border-b ${focused ? "border-text" : "border-divider"} relative`}>
          <textarea
            ref={ref}
            rows={1}
            value={text}
            placeholder={placeholder}
            aria-label={placeholder}
            onFocus={() => {
              setFocused(true);
              setOpen(true);
            }}
            onBlur={() => setFocused(false)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit();
              if (e.key === "Escape") cancel();
            }}
            className="block w-full resize-none overflow-hidden bg-transparent pb-1 text-[14px] leading-5 text-text outline-none placeholder:text-text-2"
          />
          {focused && <span aria-hidden className="absolute -bottom-px left-0 right-0 h-0.5 bg-text" />}
        </div>
        {open && (
          <div className="mt-2 flex items-center justify-end gap-2">
            {tooLong && (
              <span className="mr-auto text-[12px] text-error" data-comment-too-long>
                {[...cleanBody(text)].length.toLocaleString("en-US")} / {BODY_MAX.toLocaleString("en-US")}
              </span>
            )}
            <button type="button" onClick={cancel} className="btn-text" data-comment-cancel>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={problem !== null}
              data-comment-submit
              className="h-9 rounded-sm bg-link px-4 text-[14px] font-medium uppercase tracking-[0.007px] text-white disabled:cursor-default disabled:bg-[var(--sub-bg)] disabled:text-text-3"
            >
              {submitLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
