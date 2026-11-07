"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { bulkDoneText, bulkReducer, initBulk, selectedLabel, selectionOf, type BulkAction } from "@/lib/studio/bulk";
import { studioErrorMessage, trashExpiry, trashLabel } from "@/lib/studio/rules";
import { applyQuery, queryParams, readQuery, rowDate, toggleSort, type SortKey, type TableQuery } from "@/lib/studio/table";
import type { StudioRow, Visibility } from "@/lib/studio/types";
import { formatDate, formatTime } from "@/lib/watch/format";
import {
  AnalyticsIcon,
  ArrowDropDownIcon,
  ArrowDropUpIcon,
  CloseIcon,
  DeleteIcon,
  EditIcon,
  EyeIcon,
  FilterIcon,
  LinkIcon,
  LockIcon,
  PlayIcon,
  RestoreIcon,
  SnipsIcon,
} from "../icons";
import { Menu, MenuItem } from "../Menu";
import { RemovedNotice } from "../moderation/RemovedNotice";

const VIS: Record<Visibility, { label: string; Icon: typeof EyeIcon }> = {
  public: { label: "Public", Icon: EyeIcon },
  unlisted: { label: "Unlisted", Icon: LinkIcon },
  private: { label: "Private", Icon: LockIcon },
};
const n = (v: number) => Math.max(0, Math.floor(v)).toLocaleString("en-US");
const GRID = "md:grid-cols-[28px_minmax(0,1fr)_110px_110px_80px_90px_80px]";

function Checkbox({ checked, mixed, onChange, label }: { checked: boolean; mixed?: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(mixed);
  }, [mixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onChange}
      className="h-[18px] w-[18px] cursor-pointer accent-[var(--studio-accent)]"
    />
  );
}

function Thumb({ v }: { v: StudioRow }) {
  return (
    <span className="relative block w-[120px] shrink-0">
      {v.thumbnail ? (
        // Signed R2 links change on every load: next/image would only get in the way.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={v.thumbnail} alt="" data-thumbnail className="aspect-video w-full rounded-[2px] bg-black object-cover" />
      ) : (
        <span className="grid aspect-video w-full place-items-center rounded-[2px] bg-skeleton text-[11px] text-text-3">
          {v.status === "ready" ? "" : v.status === "failed" ? "Failed" : "Processing"}
        </span>
      )}
      {v.durationS ? (
        <span className="absolute bottom-1 right-1 rounded-[2px] bg-black/80 px-1 text-[11px] font-medium leading-4 text-white">
          {formatTime(v.durationS)}
        </span>
      ) : null}
    </span>
  );
}

function IconLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <Link href={href} aria-label={label} title={label} className="grid h-9 w-9 place-items-center rounded-full text-icon hover:bg-hover hover:text-text">
      {children}
    </Link>
  );
}

function IconButton({ onClick, label, children, disabled }: { onClick: () => void; label: string; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-full text-icon hover:bg-hover hover:text-text disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function SortHeader({ q, k, label, onSort, right }: { q: TableQuery; k: SortKey; label: string; onSort: (k: SortKey) => void; right?: boolean }) {
  const on = q.sort === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      data-sort={k}
      data-sort-dir={on ? q.dir : undefined}
      aria-label={`Sort by ${label.toLowerCase()}`}
      className={`flex items-center gap-0.5 uppercase ${right ? "justify-self-end" : ""} ${on ? "text-text" : "hover:text-text"}`}
    >
      {label}
      {on ? (q.dir === "asc" ? <ArrowDropUpIcon className="h-5 w-5" /> : <ArrowDropDownIcon className="h-5 w-5" />) : null}
    </button>
  );
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="flex h-8 items-center gap-1 rounded-full bg-hover pl-3 pr-1 text-[13px] text-text">
      <span className="text-text-2">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-8 cursor-pointer appearance-none bg-transparent pr-5 font-medium outline-none"
        style={{ backgroundImage: "none" }}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v} className="bg-surface text-text">
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function Confirm({
  title,
  children,
  action,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  action: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [sure, setSure] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 px-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] rounded-[2px] bg-surface p-6 shadow-[var(--menu-shadow)]"
      >
        <h2 className="text-[20px] leading-7 text-text">{title}</h2>
        <div className="mt-3 text-[14px] leading-5 text-text-2">{children}</div>
        <label className="mt-4 flex items-center gap-3 text-[14px] text-text">
          <Checkbox checked={sure} onChange={() => setSure(!sure)} label="I understand" />I understand the videos stay in the trash for 30 days
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn-text" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-blue" disabled={!sure} onClick={onConfirm} data-confirm>
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The 2020 Studio "Channel content" list, or the trash. */
export function ContentView({
  rows: initial,
  trash,
  now,
  preview,
  statsOn = false,
}: {
  rows: StudioRow[];
  trash: boolean;
  now: number;
  preview?: boolean;
  /** The Analytics link on each row, with the stats flag. */
  statsOn?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState<TableQuery>(() => readQuery(params));
  const [state, dispatch] = useReducer(bulkReducer, initial, initBulk);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Fresh rows from the server (after router.refresh()) replace the list.
  useEffect(() => dispatch({ type: "replace", rows: initial }), [initial]);

  // The filters live in the address, so a reload or a shared link keeps them.
  useEffect(() => {
    const text = queryParams(q);
    const url = `${window.location.pathname}${text ? `?${text}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
  }, [q]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const visible = useMemo(() => applyQuery(state.rows, q), [state.rows, q]);
  const visibleIds = visible.map((r) => r.id);
  const all = selectionOf(state.selected, visibleIds);
  const selected = new Set(state.selected);
  const busy = state.pending !== null;

  async function run(action: BulkAction, ids?: string[]) {
    const target = ids ?? state.selected;
    if (target.length === 0 || busy) return;
    dispatch({ type: "start", action, ids: target });
    if (preview) {
      dispatch({ type: "done" });
      setToast(bulkDoneText(action, target.length));
      return;
    }
    try {
      const res = await fetch("/api/studio/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: target,
          action: action.kind,
          ...(action.kind === "visibility" ? { visibility: action.visibility } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { changed?: number; error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? "failed");
      dispatch({ type: "done" });
      setToast(bulkDoneText(action, target.length));
      router.refresh();
    } catch (err) {
      const code = err instanceof Error ? err.message : "failed";
      dispatch({ type: "failed", error: code });
      setToast(studioErrorMessage(code));
    }
  }

  const tabs = (
    <div className="mb-4 flex gap-6 border-b border-divider text-[14px] font-medium uppercase" role="tablist">
      {[
        ["Videos", "/studio/content", !trash],
        ["Trash", "/studio/content/trash", trash],
      ].map(([label, href, on]) => (
        <Link
          key={String(label)}
          href={String(href)}
          role="tab"
          aria-selected={Boolean(on)}
          className={`-mb-px border-b-2 px-1 pb-3 ${on ? "border-[var(--studio-accent)] text-[var(--studio-accent)]" : "border-transparent text-text-2 hover:text-text"}`}
        >
          {label}
        </Link>
      ))}
    </div>
  );

  return (
    <div data-content-view={trash ? "trash" : "videos"}>
      {tabs}
      {trash && (
        <p className="mb-4 text-[14px] text-text-2">
          Videos in the trash are private. Each one is deleted for good 30 days after you deleted it. Restore it before then to get it back as it was.
        </p>
      )}

      <div className="overflow-visible rounded-[2px] bg-surface shadow-[0_0_0_1px_var(--divider)]">
        {state.selected.length > 0 ? (
          <div
            data-bulk-bar
            className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 bg-[var(--studio-nav)] px-4 py-1.5 text-[14px] text-[var(--studio-nav-text)] sm:rounded-t-[2px]"
          >
            <span className="font-medium" data-selected-count={state.selected.length}>
              {selectedLabel(state.selected.length)}
            </span>
            <span className="hidden h-6 w-px bg-white/20 sm:block" />
            {trash ? (
              <button type="button" disabled={busy} onClick={() => run({ kind: "restore" })} className="flex h-9 items-center gap-2 px-2 font-medium uppercase hover:bg-white/10" data-bulk="restore">
                <RestoreIcon className="h-5 w-5" /> Restore
              </button>
            ) : (
              <>
                <Menu
                  label="Edit visibility"
                  width={200}
                  buttonClassName="flex h-9 items-center gap-1 px-2 font-medium uppercase hover:bg-white/10"
                  button={
                    <>
                      Edit visibility <ArrowDropDownIcon className="h-5 w-5" />
                    </>
                  }
                >
                  {(close) =>
                    (["public", "unlisted", "private"] as Visibility[]).map((v) => {
                      const { label, Icon } = VIS[v];
                      return (
                        <MenuItem
                          key={v}
                          icon={<Icon className="h-5 w-5" />}
                          disabled={busy}
                          onClick={() => {
                            close();
                            run({ kind: "visibility", visibility: v });
                          }}
                        >
                          {label}
                        </MenuItem>
                      );
                    })
                  }
                </Menu>
                <button type="button" disabled={busy} onClick={() => setConfirm(state.selected)} className="flex h-9 items-center gap-2 px-2 font-medium uppercase hover:bg-white/10" data-bulk="trash">
                  <DeleteIcon className="h-5 w-5" /> Delete
                </button>
              </>
            )}
            <button type="button" onClick={() => dispatch({ type: "clear" })} aria-label="Clear the selection" className="ml-auto grid h-9 w-9 place-items-center rounded-full hover:bg-white/10">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 border-b border-divider px-4 py-2">
            <FilterIcon className="h-6 w-6 shrink-0 text-icon" />
            <input
              type="search"
              value={q.search}
              onChange={(e) => setQ({ ...q, search: e.target.value })}
              placeholder="Search by title"
              aria-label="Search by title"
              className="h-8 min-w-[140px] flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-text-3"
              data-content-search
            />
            <Select
              label="Visibility"
              value={q.visibility}
              onChange={(visibility) => setQ({ ...q, visibility })}
              options={[["all", "All"], ["public", "Public"], ["unlisted", "Unlisted"], ["private", "Private"]]}
            />
            <Select
              label="Type"
              value={q.kind}
              onChange={(kind) => setQ({ ...q, kind })}
              options={[["all", "All"], ["videos", "Videos"], ["shorts", "Snips"]]}
            />
          </div>
        )}

        <div className={`hidden items-center gap-4 border-b border-divider px-4 py-2.5 text-[12px] font-medium text-text-2 md:grid ${GRID}`}>
          <Checkbox checked={all === "all" && visible.length > 0} mixed={all === "some"} onChange={() => dispatch({ type: "toggle-all", visibleIds })} label="Select all" />
          <SortHeader q={q} k="title" label="Video" onSort={(k) => setQ(toggleSort(q, k))} />
          <SortHeader q={q} k="visibility" label="Visibility" onSort={(k) => setQ(toggleSort(q, k))} />
          <SortHeader q={q} k="date" label={trash ? "Deleted" : "Date"} onSort={(k) => setQ(toggleSort(q, k))} />
          <SortHeader q={q} k="views" label="Views" onSort={(k) => setQ(toggleSort(q, k))} right />
          <SortHeader q={q} k="comments" label="Comments" onSort={(k) => setQ(toggleSort(q, k))} right />
          <SortHeader q={q} k="likes" label="Likes" onSort={(k) => setQ(toggleSort(q, k))} right />
        </div>

        {/* Phones: select all and the sort as one line. */}
        <div className="flex items-center gap-3 border-b border-divider px-4 py-2 text-[13px] text-text-2 md:hidden">
          <Checkbox checked={all === "all" && visible.length > 0} mixed={all === "some"} onChange={() => dispatch({ type: "toggle-all", visibleIds })} label="Select all" />
          <span className="flex-1">{visible.length === 1 ? "1 video" : `${visible.length} videos`}</span>
          <Select
            label="Sort"
            value={`${q.sort}:${q.dir}`}
            onChange={(v) => {
              const [sort, dir] = v.split(":") as [SortKey, "asc" | "desc"];
              setQ({ ...q, sort, dir });
            }}
            options={[
              ["date:desc", "Newest"],
              ["date:asc", "Oldest"],
              ["views:desc", "Most viewed"],
              ["likes:desc", "Most liked"],
              ["comments:desc", "Most comments"],
              ["title:asc", "Title"],
            ]}
          />
        </div>

        {visible.length === 0 ? (
          <div className="px-6 py-16 text-center" data-content-empty>
            {state.rows.length === 0 ? (
              trash ? (
                <p className="text-[15px] text-text">The trash is empty</p>
              ) : (
                <>
                  <p className="text-[15px] text-text">No content available</p>
                  <Link href="/upload" className="btn-blue mt-4">
                    Upload videos
                  </Link>
                </>
              )
            ) : (
              <p className="text-[15px] text-text">No videos match these filters</p>
            )}
          </div>
        ) : (
          <ul data-content-rows>
            {visible.map((v) => {
              const on = selected.has(v.id);
              const vis = VIS[v.visibility];
              const expiry = v.deletedAt ? trashExpiry(v.deletedAt, now) : null;
              const watchHref = v.isShort ? `/shorts/${v.id}` : `/watch?v=${v.id}`;
              return (
                <li
                  key={v.id}
                  data-row={v.id}
                  data-visibility={v.visibility}
                  data-removed={v.removedAt ? "1" : undefined}
                  className={`group grid grid-cols-[28px_minmax(0,1fr)] items-start gap-x-4 gap-y-2 border-b border-divider px-4 py-3 last:border-0 md:items-center ${GRID} ${
                    on ? "bg-[var(--active)]/50" : "hover:bg-hover/60"
                  }`}
                >
                  <span className="pt-6 md:pt-0">
                    <Checkbox checked={on} onChange={() => dispatch({ type: "toggle", id: v.id })} label={`Select ${v.title}`} />
                  </span>
                  <div className="flex min-w-0 gap-3">
                    {trash ? (
                      <Thumb v={v} />
                    ) : (
                      <Link href={`/studio/video/${v.id}/edit`} className="shrink-0">
                        <Thumb v={v} />
                      </Link>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5">
                        {v.isShort && <SnipsIcon className="h-4 w-4 shrink-0 text-[var(--mark)]" />}
                        {trash ? (
                          <span className="line-clamp-2 text-[13px] leading-[18px] text-text">{v.title}</span>
                        ) : (
                          <Link href={`/studio/video/${v.id}/edit`} className="line-clamp-2 text-[13px] leading-[18px] text-text hover:underline" data-row-title>
                            {v.title}
                          </Link>
                        )}
                      </p>
                      <p className={`mt-0.5 line-clamp-1 text-[12px] leading-4 text-text-2 ${trash ? "" : "md:group-hover:hidden"}`}>
                        {trash && expiry ? trashLabel(expiry) : v.description || "Add description"}
                      </p>
                      {!trash && v.removedAt && <RemovedNotice videoId={v.id} title={v.title} reason={v.removedReason ?? null} appeal={v.appeal ?? null} />}
                      <div className={`mt-1 flex ${trash ? "" : "md:hidden md:group-hover:flex md:group-focus-within:flex"}`} data-row-actions>
                        {trash ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => run({ kind: "restore" }, [v.id])}
                            className="flex h-8 items-center gap-1.5 rounded-[2px] px-2 text-[13px] font-medium uppercase text-[var(--studio-accent)] hover:bg-hover"
                            data-restore
                          >
                            <RestoreIcon className="h-5 w-5" /> Restore
                          </button>
                        ) : (
                          <>
                            <IconLink href={`/studio/video/${v.id}/edit`} label="Details">
                              <EditIcon className="h-5 w-5" />
                            </IconLink>
                            {statsOn && (
                              <IconLink href={`/studio/video/${v.id}/analytics`} label="Analytics">
                                <AnalyticsIcon className="h-5 w-5" />
                              </IconLink>
                            )}
                            <IconLink href={watchHref} label="View on sloptube">
                              <PlayIcon className="h-5 w-5" />
                            </IconLink>
                            <IconButton onClick={() => setConfirm([v.id])} label="Delete" disabled={busy}>
                              <DeleteIcon className="h-5 w-5" />
                            </IconButton>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Phones: one line of numbers under the title. */}
                  <p className="col-start-2 flex flex-wrap gap-x-3 text-[12px] text-text-2 md:hidden">
                    <span className="inline-flex items-center gap-1">
                      <vis.Icon className="h-4 w-4" />
                      {vis.label}
                    </span>
                    <span>{formatDate(rowDate(v))}</span>
                    <span>{n(v.views)} views</span>
                    <span>{n(v.comments)} comments</span>
                    <span>{n(v.likes)} likes</span>
                  </p>
                  <span className="hidden items-center gap-1.5 text-[13px] text-text md:flex" data-cell="visibility">
                    <vis.Icon className="h-5 w-5 text-icon" />
                    {vis.label}
                  </span>
                  <span className="hidden text-[13px] text-text md:block">
                    {formatDate(rowDate(v))}
                    <span className="block text-[12px] text-text-2">
                      {v.deletedAt ? (expiry?.daysLeft ?? 0) + " days left" : v.publishedAt ? "Published" : "Uploaded"}
                    </span>
                  </span>
                  <span className="hidden justify-self-end text-[13px] text-text md:block" data-cell="views">
                    {n(v.views)}
                  </span>
                  <span className="hidden justify-self-end text-[13px] text-text md:block">{n(v.comments)}</span>
                  <span className="hidden justify-self-end text-[13px] text-text md:block">{n(v.likes)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {confirm && (
        <Confirm
          title={confirm.length === 1 ? "Delete this video?" : `Delete ${confirm.length} videos?`}
          action="Move to trash"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const ids = confirm;
            setConfirm(null);
            void run({ kind: "trash" }, ids);
          }}
        >
          {confirm.length === 1 ? (
            <>
              <span className="text-text">{state.rows.find((r) => r.id === confirm[0])?.title}</span> goes to the trash and becomes private.
            </>
          ) : (
            "They go to the trash and become private."
          )}{" "}
          You can restore them from the Trash tab for 30 days. After that they are deleted for good, with their comments and views.
        </Confirm>
      )}

      {toast && (
        <div role="status" data-toast className="fixed bottom-6 left-6 z-[70] max-w-[calc(100vw-48px)] rounded-[2px] bg-[#323232] px-4 py-3 text-[14px] text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
