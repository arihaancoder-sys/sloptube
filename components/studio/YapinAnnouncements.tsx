"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { YapinIcon } from "@/components/icons";
import { POST_STATUS_TEXT, webhookProblem, yapinErrorText } from "@/lib/yapin/rules";
import type { Announcements, YapinPost } from "@/lib/yapin/server";

const STATUS_COLOR: Record<YapinPost["status"], string> = {
  queued: "text-text-2",
  sending: "text-text-2",
  sent: "text-[#2ba640]",
  failed: "text-error",
};

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Studio > Settings > Yapin' announcements (feature 16): paste the incoming
 * webhook URL of a Yapin' channel and every new public upload is posted
 * there as a card. The URL is never shown again after saving, only its last
 * 4 characters. Below it, what was posted and what failed.
 */
export function YapinAnnouncements({ initial }: { initial: Announcements }) {
  const [state, setState] = useState(initial);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function save(next: string) {
    const problem = webhookProblem(next);
    if (problem) return setError(yapinErrorText(problem));
    setBusy(true);
    setError(null);
    setSaved(null);
    const res = await fetch("/api/yapin/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: next }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { connected?: boolean; hint?: string | null; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !json || json.error) return setError(yapinErrorText(json?.error ?? "failed"));
    setState((s) => ({ ...s, connected: json.connected === true, hint: json.hint ?? null }));
    setUrl("");
    setSaved(json.connected ? "Saved. New public uploads are posted to your Yapin' channel." : "Disconnected.");
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (url.trim()) save(url);
  }

  return (
    <section data-yapin-announcements={state.connected ? "connected" : "off"} className="rounded-[2px] bg-surface px-6 py-5 shadow-[0_0_0_1px_var(--divider)]">
      <div className="flex items-start gap-4">
        <YapinIcon className="h-10 w-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-medium text-text">Yapin&apos; announcements</h2>
          <p className="mt-1 text-[14px] text-text-2">
            Post a card with the title, thumbnail and link in a Yapin&apos; channel when you publish a video. Make an
            incoming webhook for the channel in Yapin&apos; and paste its URL here.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-4 flex flex-wrap items-center gap-2" noValidate>
        <label htmlFor="yapin-webhook" className="sr-only">
          Webhook URL
        </label>
        <input
          id="yapin-webhook"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={state.connected ? `Connected, ends in ${state.hint ?? "...."}` : "https://www.yapin.gg/api/webhooks/..."}
          data-yapin-webhook-input
          className="h-10 min-w-0 flex-1 basis-[260px] rounded-[2px] border border-divider bg-[var(--input-bg)] px-3 text-[14px] text-text outline-none placeholder:text-text-3 focus:border-[var(--link)]"
        />
        <button type="submit" disabled={busy || !url.trim()} data-yapin-webhook-save className="btn-blue !normal-case rounded">
          {busy ? "Saving" : "Save"}
        </button>
        {state.connected && (
          <button type="button" disabled={busy} onClick={() => save("")} data-yapin-webhook-remove className="h-9 px-4 text-[14px] font-medium uppercase text-text-2 hover:bg-hover disabled:opacity-60">
            Disconnect
          </button>
        )}
      </form>
      {(error || saved) && (
        <p role="status" data-yapin-webhook-note className={`mt-2 text-[13px] ${error ? "text-error" : "text-text"}`}>
          {error ?? saved}
        </p>
      )}
      {state.connected && !error && !saved && (
        <p className="mt-2 text-[12px] text-text-2">The URL is kept secret and never shown again. Paste a new one to replace it.</p>
      )}

      <h3 className="mt-6 text-[14px] font-medium text-text">Posts</h3>
      {state.posts.length === 0 ? (
        <p data-yapin-posts="empty" className="mt-2 text-[14px] text-text-2">
          Nothing posted yet. Your next public upload shows up here.
        </p>
      ) : (
        <ul data-yapin-posts="list" className="mt-2 divide-y divide-divider border-y border-divider">
          {state.posts.map((p) => (
            <li key={p.id} data-yapin-post={p.status} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5 text-[14px]">
              <Link href={`/watch?v=${p.videoId}`} className="min-w-0 flex-1 basis-[200px] truncate text-text hover:underline">
                {p.title}
              </Link>
              <span className={`font-medium ${STATUS_COLOR[p.status]}`}>{POST_STATUS_TEXT[p.status]}</span>
              <span className="text-[13px] text-text-2">
                {p.attempts > 1 ? `${p.attempts} tries, ` : ""}
                {when(p.finishedAt ?? p.queuedAt)}
              </span>
              {p.status === "failed" && p.error && <span className="basis-full text-[13px] text-error">{p.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
