"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { moderationErrorMessage } from "@/lib/moderation/rules";
import type { Word } from "@/lib/moderation/types";
import { cleanWord, isWord } from "@/lib/moderation/words";
import { formatDate } from "@/lib/watch/format";
import { card } from "./AdminShell";

/** The automod word list: add a word or phrase, remove one. */
export function AdminWords({ words: initial, preview }: { words: Word[]; preview?: boolean }) {
  const router = useRouter();
  const [words, setWords] = useState(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (word: string, on: boolean) => {
    if (preview) return true;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/words", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ word, on }),
      });
      if (res.ok) {
        router.refresh();
        return true;
      }
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(moderationErrorMessage(json.error));
      return false;
    } catch {
      setError(moderationErrorMessage("failed"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const w = cleanWord(draft);
    if (!isWord(w)) return setError(moderationErrorMessage("bad_word"));
    setError(null);
    if (words.some((x) => x.word === w)) return setDraft("");
    if (await send(w, true)) {
      setWords((list) => [...list, { word: w, createdAt: new Date().toISOString(), addedBy: "you" }].sort((a, b) => a.word.localeCompare(b.word)));
      setDraft("");
    }
  };

  return (
    <section aria-label="Word list" data-words={words.length}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a word or phrase, like free gift card or scam*"
          aria-label="Word or phrase"
          maxLength={60}
          className="h-9 min-w-0 flex-1 rounded-[2px] border border-divider bg-surface px-2 text-[13px] text-text outline-none placeholder:text-text-2 focus:border-[var(--studio-accent)]"
          data-word-input
        />
        <button type="submit" className="btn-blue" disabled={busy || !draft.trim()} data-word-add>
          Add
        </button>
      </form>
      {error && (
        <p className="mt-2 text-[13px] text-[var(--error)]" role="alert" data-word-error>
          {error}
        </p>
      )}
      {words.length === 0 ? (
        <p className={`${card} mt-4 px-4 py-10 text-center text-[14px] text-text-2`} data-words-empty>
          No words yet. Comments, titles and descriptions with a listed word are refused.
        </p>
      ) : (
        <ul className={`${card} mt-4 divide-y divide-divider`}>
          {words.map((w) => (
            <li key={w.word} className="flex items-center gap-3 px-4 py-2" data-word={w.word}>
              <span className="min-w-0 flex-1 break-words font-mono text-[14px] text-text">{w.word}</span>
              <span className="hidden text-[12px] text-text-2 sm:inline">
                {w.addedBy ? `${w.addedBy}, ` : ""}
                {formatDate(w.createdAt)}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (await send(w.word, false)) setWords((list) => list.filter((x) => x.word !== w.word));
                }}
                className="h-8 rounded-[2px] px-2 text-[13px] font-medium uppercase text-[var(--studio-accent)] hover:bg-hover disabled:opacity-50"
                data-word-remove={w.word}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
