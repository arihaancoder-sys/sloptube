"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { accountErrorText } from "@/lib/accounts/validation";
import { createClient } from "@/lib/supabase/client";
import { FormError, OrDivider, TextField } from "./fields";
import { GoogleButton } from "./GoogleButton";
import { YapinButton } from "./YapinButton";

export function LoginForm({ next, initialError, yapin = false }: { next: string; initialError?: string | null; yapin?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    if (!supabase) return setError("database not connected");
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setBusy(false);
      return setError(accountErrorText(error.message));
    }
    router.push(next);
    router.refresh();
  }

  return (
    <>
      <GoogleButton label="Sign in with Google" next={next} />
      {yapin && <YapinButton next={next} />}
      <OrDivider />
      <form onSubmit={submit} className="space-y-6" noValidate>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError message={error} />
        <div className="flex items-center justify-between pt-4">
          <Link
            href={next === "/" ? "/signup" : `/signup?next=${encodeURIComponent(next)}`}
            className="-ml-2 rounded px-2 py-2 text-[14px] font-medium text-[var(--link)] hover:bg-hover"
          >
            Create account
          </Link>
          <button type="submit" disabled={busy || !email || !password} className="btn-blue !normal-case rounded">
            {busy ? "Signing in" : "Sign in"}
          </button>
        </div>
      </form>
    </>
  );
}
