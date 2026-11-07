"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { addRecent, parseRecent, RECENT_KEY, removeRecent } from "@/lib/search/recent";
import { normalizeQuery, resultsHref } from "@/lib/search/query";
import { SUGGEST_DEBOUNCE_MS } from "@/lib/search/rules";
import { dedupeSuggestions, splitSuggestion } from "@/lib/search/suggest";
import { useFlag } from "@/lib/store/session";
import { ArrowBackIcon, CloseIcon, HistoryIcon, MicIcon, SearchIcon } from "./icons";

type Item = { kind: "recent" | "suggest"; text: string };

function loadRecent(): string[] {
  try {
    return parseRecent(localStorage.getItem(RECENT_KEY));
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Private windows and blocked storage: recent searches just are not kept.
  }
}

/** Suggestions already fetched this page load, by normalized query. */
const cache = new Map<string, string[]>();

/**
 * Suggestions for what is typed, 150 ms after the last key. Older answers
 * that arrive late are dropped (the request is aborted).
 */
function useSuggestions(typed: string, on: boolean): { q: string; list: string[] } {
  const [result, setResult] = useState<{ q: string; list: string[] }>({ q: "", list: [] });
  const q = on ? normalizeQuery(typed) : "";

  useEffect(() => {
    if (!q) return;
    const hit = cache.get(q.toLowerCase());
    const ctrl = new AbortController();
    const t = setTimeout(
      async () => {
        if (hit) return setResult({ q, list: hit });
        try {
          const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
          if (!res.ok) return;
          const list = dedupeSuggestions(((await res.json()) as { suggestions?: unknown }).suggestions);
          cache.set(q.toLowerCase(), list);
          setResult({ q, list });
        } catch {
          // Aborted or offline: keep what is there.
        }
      },
      hit ? 0 : SUGGEST_DEBOUNCE_MS,
    );
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  return q && result.q === q ? result : { q, list: [] };
}

function SearchForm({
  initialQuery,
  variant,
  autoFocus,
  onDone,
}: {
  initialQuery: string;
  variant: "bar" | "overlay";
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const on = useFlag("search");
  const id = useId();
  const listId = `${id}-list`;
  const input = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState(initialQuery);
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const suggestions = useSuggestions(typed, on);

  const empty = typed.trim() === "";
  const items: Item[] = !on
    ? []
    : empty
      ? recent.map((text) => ({ kind: "recent" as const, text }))
      : suggestions.list.map((text) => ({ kind: "suggest" as const, text }));
  const listOpen = (focused || variant === "overlay") && !dismissed && items.length > 0;
  const current = listOpen && active >= 0 && active < items.length ? items[active] : null;
  const value = current ? current.text : typed;

  function go(raw: string) {
    const q = normalizeQuery(raw);
    if (!q) return;
    if (on) {
      const next = addRecent(loadRecent(), q);
      saveRecent(next);
      setRecent(next);
    }
    setTyped(q);
    setActive(-1);
    setDismissed(true);
    input.current?.blur();
    onDone?.();
    router.push(resultsHref(q));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    go(value);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!items.length) return;
      e.preventDefault();
      if (dismissed) {
        setDismissed(false);
        return;
      }
      const n = items.length;
      // -1 is the typed text itself, like the 2019 box: down past the last row goes back to it.
      setActive((a) => (e.key === "ArrowDown" ? (a + 2) % (n + 1) - 1 : ((a + n + 1) % (n + 1)) - 1));
    } else if (e.key === "Escape") {
      if (listOpen) {
        e.preventDefault();
        setDismissed(true);
        setActive(-1);
      } else if (variant === "overlay") {
        onDone?.();
      }
    }
  }

  function forget(text: string) {
    const next = removeRecent(loadRecent(), text);
    saveRecent(next);
    setRecent(next);
    setActive(-1);
  }

  const list = listOpen && (
    <ul
      id={listId}
      role="listbox"
      aria-label={empty ? "Recent searches" : "Suggestions"}
      data-search-list={empty ? "recent" : "suggest"}
      // Keep the focus in the box while a row is clicked.
      onMouseDown={(e) => e.preventDefault()}
      className={
        variant === "bar"
          ? "absolute left-0 right-[65px] top-full z-50 border border-t-0 border-[var(--input-border)] bg-surface py-4 shadow-[0_2px_4px_rgba(0,0,0,0.2)]"
          : "fixed inset-x-0 bottom-0 top-14 z-50 overflow-y-auto bg-surface py-2"
      }
    >
      {items.map((item, i) => {
        const parts = item.kind === "suggest" ? splitSuggestion(item.text, typed) : null;
        const Icon = item.kind === "recent" ? HistoryIcon : SearchIcon;
        return (
          <li
            key={`${item.kind}:${item.text}`}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            data-search-option={item.kind}
            data-active={i === active || undefined}
            onMouseEnter={() => setActive(i)}
            onClick={() => go(item.text)}
            className={`flex cursor-default items-center gap-3 pl-4 pr-2 text-[16px] leading-8 ${
              variant === "overlay" ? "h-12" : "h-8"
            } ${i === active ? "bg-[var(--active)]" : ""} ${item.kind === "recent" ? "text-[var(--recent)]" : "text-text"}`}
          >
            <Icon className="h-5 w-5 shrink-0 text-text-3" />
            <span className="min-w-0 flex-1 truncate">
              {parts ? (
                <>
                  {parts.typed}
                  <b className="font-medium">{parts.rest}</b>
                </>
              ) : (
                item.text
              )}
            </span>
            {item.kind === "recent" && (
              <button
                type="button"
                aria-label={`Remove ${item.text} from recent searches`}
                data-search-remove
                onClick={(e) => {
                  e.stopPropagation();
                  forget(item.text);
                }}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-3 hover:text-text"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <form role="search" action="/results" onSubmit={onSubmit} className="relative flex h-10 min-w-0 flex-1 items-stretch">
      <label htmlFor={id} className="sr-only">
        Search
      </label>
      <input
        ref={input}
        id={id}
        name="search_query"
        type="search"
        placeholder="Search"
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={200}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={Boolean(listOpen)}
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={current ? `${id}-opt-${active}` : undefined}
        value={value}
        onChange={(e) => {
          setTyped(e.target.value);
          setActive(-1);
          setDismissed(false);
        }}
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
          if (on) setRecent(loadRecent());
        }}
        onBlur={() => {
          setFocused(false);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        style={{ boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)" }}
        className="h-10 min-w-0 flex-1 rounded-l-[2px] border border-[var(--input-border)] bg-[var(--input-bg)] px-[6px] pl-2 text-[16px] text-text outline-none placeholder:text-text-3 focus:border-[var(--focus)] [&::-webkit-search-cancel-button]:hidden"
      />
      <button
        type="submit"
        aria-label="Search"
        className="grid h-10 w-[65px] shrink-0 place-items-center rounded-r-[2px] border border-l-0 border-[var(--search-btn-border)] bg-[var(--search-btn)] text-icon hover:text-text"
      >
        <SearchIcon className="h-5 w-5" />
      </button>
      {list}
    </form>
  );
}

/**
 * The centered search box. Typing shows suggestions (with the search flag
 * on), an empty box shows recent searches, Enter or the button goes to
 * /results?search_query=<q>. Below 656 px it folds into an icon that opens a
 * full width search with the suggestions under it, like the 2019 site did on
 * narrow windows.
 */
export function SearchBox({ initialQuery = "" }: { initialQuery?: string }) {
  const [open, setOpen] = useState(false);
  // Feature 18: no search box until the search flag is on (the spacer keeps the right side right).
  const on = useFlag("search");
  if (!on) return <div className="flex-1" aria-hidden />;

  return (
    <>
      <div className="mx-10 hidden min-w-0 max-w-[728px] flex-1 items-center search:flex" data-search-box="bar">
        <div className="flex min-w-0 max-w-[640px] flex-1">
          <SearchForm initialQuery={initialQuery} variant="bar" />
        </div>
        <button
          type="button"
          aria-label="Search with your voice"
          disabled
          title="Voice search is not part of sloptube yet"
          className="ml-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-icon"
        >
          <MicIcon className="h-6 w-6" />
        </button>
      </div>

      <div className="flex flex-1 justify-end search:hidden">
        <button
          type="button"
          aria-label="Search"
          data-search-open
          onClick={() => setOpen(true)}
          className="grid h-10 w-10 place-items-center rounded-full text-icon hover:bg-hover"
        >
          <SearchIcon className="h-6 w-6" />
        </button>
      </div>

      {open && (
        <div className="absolute inset-0 z-10 flex items-center gap-2 bg-surface px-2 search:hidden" data-search-box="overlay">
          <button
            type="button"
            aria-label="Back"
            onClick={() => setOpen(false)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-icon hover:bg-hover"
          >
            <ArrowBackIcon className="h-6 w-6" />
          </button>
          <SearchForm initialQuery={initialQuery} variant="overlay" autoFocus onDone={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}

/** The box with the query of the results page in it. Reads the URL, so it sits in <Suspense>. */
export function SearchBoxFromUrl() {
  const pathname = usePathname();
  const params = useSearchParams();
  const q = pathname === "/results" ? normalizeQuery(params.get("search_query")) : "";
  // A new query remounts the box, so it shows the new text.
  return <SearchBox key={q} initialQuery={q} />;
}
