"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CHOICES,
  PANEL_FLAGS,
  choiceOf,
  flagPanelErrorMessage,
  isPanelShortcut,
  modeOfChoice,
  type PanelChoice,
  type PanelFlagState,
} from "@/lib/flag-panel";

/**
 * The flag panel (feature 17): a small floating panel for admins that flips
 * the real feature flags for the demo. Ctrl+Shift+S (Cmd+Shift+S on a Mac)
 * opens and closes it, Escape closes it. Drag it by its title bar, fold it to
 * the bar with the arrow. Where it sits and whether it is open or folded is
 * remembered in this browser only.
 *
 * Every switch calls POST /api/admin/flags, which runs set_feature_flag
 * (migration 020), then refreshes the page so it shows the feature at once.
 * Other people see the change on their next page load, the same as a flag
 * flipped in the table editor.
 */

const STORE = "sloptube:flag-panel";
type Ui = { open: boolean; folded: boolean; x: number; y: number };
const DEFAULT_UI: Ui = { open: false, folded: false, x: 16, y: 72 };

function readUi(): Ui {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return DEFAULT_UI;
    const v = JSON.parse(raw) as Partial<Ui>;
    return {
      open: v.open === true,
      folded: v.folded === true,
      x: typeof v.x === "number" ? v.x : DEFAULT_UI.x,
      y: typeof v.y === "number" ? v.y : DEFAULT_UI.y,
    };
  } catch {
    return DEFAULT_UI;
  }
}

function writeUi(ui: Ui) {
  try {
    localStorage.setItem(STORE, JSON.stringify(ui));
  } catch {
    // Private mode or storage full: the panel still works, it just forgets.
  }
}

// A tiny store for where the panel sits, read from localStorage once in the
// browser (the server snapshot is null, so the panel never renders in HTML).
let cached: Ui | null = null;
const listeners = new Set<() => void>();
function getUi(): Ui | null {
  if (cached === null && typeof window !== "undefined") cached = readUi();
  return cached;
}
function setUi(next: Ui | ((u: Ui) => Ui)) {
  cached = typeof next === "function" ? next(getUi() ?? DEFAULT_UI) : next;
  writeUi(cached);
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const serverUi = () => null;

const WIDTH = 304;

export function FlagPanel({ initial }: { initial: Record<string, PanelFlagState> }) {
  const router = useRouter();
  const ui = useSyncExternalStore(subscribe, getUi, serverUi);
  const [states, setStates] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  // The server hands fresh states on every render (router.refresh after a change).
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setStates(initial);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isPanelShortcut(e)) {
        e.preventDefault();
        setUi((u) => ({ ...u, open: !u.open }));
      } else if (e.key === "Escape") {
        setUi((u) => (u.open ? { ...u, open: false } : u));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onDragStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!ui || (e.target as HTMLElement).closest("button")) return;
      drag.current = { dx: e.clientX - ui.x, dy: e.clientY - ui.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [ui],
  );
  const onDragMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const x = Math.max(0, Math.min(window.innerWidth - WIDTH, e.clientX - drag.current.dx));
    const y = Math.max(0, Math.min(window.innerHeight - 48, e.clientY - drag.current.dy));
    setUi((u) => ({ ...u, x, y }));
  }, []);
  const onDragEnd = useCallback(() => {
    drag.current = null;
  }, []);

  async function flip(key: string, choice: Exclude<PanelChoice, "test">) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/flags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, mode: modeOfChoice(choice) }),
      });
      const body = (await res.json().catch(() => null)) as (PanelFlagState & { error?: string }) | null;
      if (!res.ok || !body || body.error) {
        setError(`${PANEL_FLAGS.find((f) => f.key === key)?.label ?? key}: ${flagPanelErrorMessage(body?.error)}`);
        return;
      }
      setStates((s) => ({ ...s, [key]: { mode: body.mode, mine: body.mine } }));
      router.refresh();
    } catch {
      setError(flagPanelErrorMessage("failed"));
    } finally {
      setBusy(null);
    }
  }

  if (!ui || !ui.open) return null;

  const missing = PANEL_FLAGS.filter((f) => !states[f.key]).length;

  return (
    <section
      aria-label="Feature flags"
      data-flag-panel
      className="fixed z-50 rounded-[2px] bg-surface text-[13px] text-text shadow-[var(--menu-shadow)] select-none"
      style={{ left: ui.x, top: ui.y, width: WIDTH }}
    >
      <div
        className="flex h-10 cursor-grab items-center gap-2 border-b border-divider px-3 active:cursor-grabbing"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <span className="text-[14px] font-medium">Flags</span>
        <span className="text-[11px] text-text-3">Ctrl+Shift+S</span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label={ui.folded ? "Unfold" : "Fold"}
          aria-expanded={!ui.folded}
          onClick={() => setUi((u) => ({ ...u, folded: !u.folded }))}
          className="grid h-8 w-8 place-items-center rounded-full text-icon hover:bg-hover"
        >
          <svg viewBox="0 0 24 24" className={`h-5 w-5 transition-transform ${ui.folded ? "rotate-180" : ""}`} aria-hidden>
            <path fill="currentColor" d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={() => setUi((u) => ({ ...u, open: false }))}
          className="grid h-8 w-8 place-items-center rounded-full text-icon hover:bg-hover"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
            <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      </div>
      {!ui.folded && (
        <div className="max-h-[70vh] overflow-y-auto py-1">
          {PANEL_FLAGS.map((f) => {
            const state = states[f.key];
            const current = choiceOf(state);
            const saving = busy === f.key;
            return (
              <div key={f.key} className="flex items-center gap-2 px-3 py-1" data-flag-row={f.key}>
                <span className="w-5 shrink-0 text-right text-[11px] text-text-3">{f.n ?? ""}</span>
                <span className="min-w-0 flex-1 truncate" title={f.key}>
                  {f.label}
                </span>
                {state ? (
                  <div className="flex overflow-hidden rounded-[2px] border border-divider" role="group" aria-label={f.label}>
                    {CHOICES.map((c) => {
                      const on = current === c.choice;
                      return (
                        <button
                          key={c.choice}
                          type="button"
                          aria-pressed={on}
                          disabled={!!busy}
                          onClick={() => flip(f.key, c.choice)}
                          className={`h-7 px-2 text-[12px] ${
                            on ? "bg-link text-white" : "text-text-2 hover:bg-hover"
                          } disabled:opacity-60`}
                        >
                          {saving && on ? "…" : c.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-[11px] text-text-3">no row</span>
                )}
                {current === "test" && <span className="text-[11px] text-text-3">test</span>}
              </div>
            );
          })}
          {missing > 0 && (
            <p className="px-3 pt-1 text-[11px] text-text-3">
              {missing} {missing === 1 ? "flag has" : "flags have"} no row yet: apply its migration first.
            </p>
          )}
          {error && (
            <p className="px-3 pt-1 text-[12px] text-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
