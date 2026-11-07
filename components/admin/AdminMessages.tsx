"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ContactMessage } from "@/lib/launch/server";
import { launchErrorMessage, TOPIC_LABELS } from "@/lib/launch/rules";
import { timeAgo } from "@/lib/watch/format";
import { card } from "./AdminShell";

/** The contact form's messages, newest first, with Mark handled and Open again. */
export function AdminMessages({ messages, now, preview, all }: { messages: ContactMessage[]; now: number; preview: boolean; all: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});

  const mark = async (m: ContactMessage, handled: boolean) => {
    setProblem(null);
    if (preview) return setDone((d) => ({ ...d, [m.id]: handled }));
    setBusy(m.id);
    try {
      const res = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: m.id, handled }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setProblem(launchErrorMessage(json.error));
      setDone((d) => ({ ...d, [m.id]: handled }));
      router.refresh();
    } catch {
      setProblem(launchErrorMessage("failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-admin-messages={messages.length}>
      <div className="mb-4 flex items-center justify-between gap-4 text-[14px]">
        <p className="text-text-2">
          {messages.length === 0 ? (all ? "No messages yet." : "No open messages.") : `${messages.length} ${all ? "" : "open "}message${messages.length === 1 ? "" : "s"}`}
        </p>
        <a href={all ? "/admin/messages" : "/admin/messages?all=1"} className="font-medium uppercase text-link">
          {all ? "Open only" : "Show handled too"}
        </a>
      </div>
      {problem && (
        <p role="alert" className="mb-4 text-[14px] text-error">
          {problem}
        </p>
      )}
      {messages.length === 0 ? (
        <div className={`${card} px-4 py-12 text-center text-[14px] text-text-2`} data-admin-empty>
          When someone uses the contact form, the message shows up here.
        </div>
      ) : (
        <ul className="space-y-3">
          {messages.map((m) => {
            const handled = done[m.id] ?? Boolean(m.handledAt);
            return (
              <li key={m.id} className={`${card} px-4 py-4 sm:px-6 ${handled ? "opacity-60" : ""}`} data-message={m.id} data-handled={handled ? "1" : undefined}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[15px] font-medium text-text">{m.name}</span>
                  <a href={`mailto:${m.email}`} className="text-[14px] text-link hover:underline">
                    {m.email}
                  </a>
                  {m.senderHandle && <span className="text-[13px] text-text-2">@{m.senderHandle}</span>}
                  <span className="rounded-[2px] bg-hover px-2 py-0.5 text-[12px] font-medium uppercase text-text-2">{TOPIC_LABELS[m.topic] ?? m.topic}</span>
                  <span className="text-[13px] text-text-2">{timeAgo(m.createdAt, now)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-5 text-text">{m.body}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn-text !px-2 !text-link" disabled={busy === m.id} onClick={() => void mark(m, !handled)}>
                    {handled ? "Open again" : "Mark handled"}
                  </button>
                  <a className="btn-text !px-2" href={`mailto:${m.email}?subject=${encodeURIComponent("Re: your message")}`}>
                    Reply
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
