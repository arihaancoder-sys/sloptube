import Link from "next/link";
import { LOG_LABELS } from "@/lib/moderation/rules";
import type { LogEntry } from "@/lib/moderation/types";
import { formatDate } from "@/lib/watch/format";
import { card } from "./AdminShell";

function time(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${formatDate(iso)}, ${d.toISOString().slice(11, 16)} UTC`;
}

/** Every moderation action, newest first, 50 a page. */
export function AdminLog({ entries }: { entries: LogEntry[] }) {
  const last = entries.at(-1);
  return (
    <section aria-label="Mod log" data-log={entries.length}>
      {entries.length === 0 ? (
        <p className={`${card} px-4 py-10 text-center text-[14px] text-text-2`} data-log-empty>
          Nothing has happened yet.
        </p>
      ) : (
        <ol className={`${card} divide-y divide-divider`}>
          {entries.map((e) => (
            <li key={e.id} className="grid gap-x-4 gap-y-0.5 px-4 py-3 text-[13px] leading-[18px] md:grid-cols-[180px_minmax(0,1fr)]" data-log-action={e.action}>
              <span className="text-text-2">{time(e.createdAt)}</span>
              <div className="min-w-0">
                <p className="text-text">
                  <span className="font-medium">{e.actorName}</span> {(LOG_LABELS[e.action] ?? e.action).toLowerCase()}
                  {e.targetLabel && (
                    <>
                      : <span className="break-words">{e.targetLabel}</span>
                    </>
                  )}
                </p>
                {e.reason && <p className="break-words text-text-2">{e.reason}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {entries.length === 50 && last && (
        <Link href={`/admin/log?before=${encodeURIComponent(last.createdAt)}`} className="btn-text mt-3 !text-[var(--studio-accent)]" data-log-older>
          Older
        </Link>
      )}
    </section>
  );
}
