"use client";

import { useState, type FormEvent } from "react";
import { BODY_MAX, contactProblem, CONTACT_TOPICS, launchErrorMessage, NAME_MAX, TOPIC_LABELS, type ContactTopic } from "@/lib/launch/rules";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; code: string };

/** The /contact form: name, email, topic and message, sent to POST /api/contact. */
export function ContactForm({ initialTopic = "general" }: { initialTopic?: ContactTopic }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState<ContactTopic>(initialTopic);
  const [body, setBody] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = { name, email, topic, body };
    const problem = contactProblem(input);
    if (problem) return setState({ kind: "error", code: problem });
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !json.id) return setState({ kind: "error", code: json.error ?? "failed" });
      setState({ kind: "sent" });
    } catch {
      setState({ kind: "error", code: "failed" });
    }
  };

  if (state.kind === "sent") {
    return (
      <div role="status" className="mt-6 rounded-[2px] bg-hover px-4 py-6 text-[15px] text-text" data-contact-state="sent">
        Thanks, your message is on its way. We&apos;ll reply to <strong>{email.trim().toLowerCase()}</strong>.
      </div>
    );
  }

  const label = "block text-[13px] font-medium text-text-2";
  return (
    <form onSubmit={submit} noValidate className="mt-6 max-w-[560px] space-y-5" data-contact-state={state.kind}>
      <div>
        <label htmlFor="contact-name" className={label}>
          Your name
        </label>
        <input id="contact-name" className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} autoComplete="name" required />
      </div>
      <div>
        <label htmlFor="contact-email" className={label}>
          Email address
        </label>
        <input id="contact-email" type="email" className="field mt-1" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </div>
      <div>
        <label htmlFor="contact-topic" className={label}>
          What is it about?
        </label>
        <select id="contact-topic" className="field mt-1" value={topic} onChange={(e) => setTopic(e.target.value as ContactTopic)}>
          {CONTACT_TOPICS.map((t) => (
            <option key={t} value={t}>
              {TOPIC_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="contact-body" className={label}>
          Message
        </label>
        <textarea id="contact-body" className="field mt-1" rows={7} value={body} onChange={(e) => setBody(e.target.value)} maxLength={BODY_MAX} required />
        <p className="mt-1 text-right text-[12px] text-text-2">
          {body.length} / {BODY_MAX}
        </p>
      </div>
      {state.kind === "error" && (
        <p role="alert" className="text-[14px] text-error" data-contact-error={state.code}>
          {launchErrorMessage(state.code)}
        </p>
      )}
      <button type="submit" className="btn-blue" disabled={state.kind === "sending"}>
        {state.kind === "sending" ? "Sending" : "Send"}
      </button>
    </form>
  );
}
