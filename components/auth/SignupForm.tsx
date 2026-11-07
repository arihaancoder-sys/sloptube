"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  PASSWORD_MIN,
  accountErrorText,
  birthdateProblem,
  normalizeUsername,
} from "@/lib/accounts/validation";
import { createClient } from "@/lib/supabase/client";
import { BirthdayFields, birthdayValue, emptyBirthday } from "./BirthdayFields";
import { FieldNote, FormError, OrDivider, TextField } from "./fields";
import { GoogleButton } from "./GoogleButton";
import { YapinButton } from "./YapinButton";
import { useUsernameCheck, usernameNote } from "./useUsernameCheck";

export function SignupForm({ next, yapin = false }: { next: string; yapin?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [birthday, setBirthday] = useState(emptyBirthday);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const status = useUsernameCheck(username);

  const birthdate = birthdayValue(birthday);
  const ageProblem = birthday.year.length === 4 ? birthdateProblem(birthdate) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const name = normalizeUsername(username);
    if (status.state === "invalid" || status.state === "taken") return setError(usernameNote(status).error!);
    if (password.length < PASSWORD_MIN) return setError(`Use ${PASSWORD_MIN} or more characters for your password.`);
    const problem = birthdateProblem(birthdate);
    if (problem) return setError(accountErrorText(problem));

    const supabase = createClient();
    if (!supabase) return setError("database not connected");
    setBusy(true);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // The database trigger reads these and refuses under 13 right away.
        data: { username: name, birthdate },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setBusy(false);
      return setError(accountErrorText(error.message));
    }

    if (!data.session) {
      // Email confirmation is on: finish on /welcome after the link is opened.
      setBusy(false);
      return setSentTo(email.trim());
    }

    const { error: rpcError } = await supabase.rpc("complete_signup", { username: name, birthdate });
    if (rpcError) {
      router.push(`/welcome?next=${encodeURIComponent(next)}`);
    } else {
      router.push(next);
    }
    router.refresh();
  }

  if (sentTo) {
    return (
      <div className="space-y-4 text-[14px] leading-5 text-text">
        <p>
          We sent a link to <strong>{sentTo}</strong>. Open it on this device to finish creating
          your account.
        </p>
        <p className="text-text-2">No email after a few minutes? Check your spam folder.</p>
      </div>
    );
  }

  const note = usernameNote(status);

  return (
    <>
      <GoogleButton label="Sign up with Google" next={next} />
      {yapin && <YapinButton next={next} />}
      <OrDivider />
      <form onSubmit={submit} className="space-y-5" noValidate>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={25}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          hint={note.hint}
          error={note.error}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`Use ${PASSWORD_MIN} or more characters`}
        />
        <div>
          <BirthdayFields value={birthday} onChange={setBirthday} />
          <FieldNote
            hint="You must be 13 or older. Your birthday is never shown to anyone."
            error={ageProblem ? accountErrorText(ageProblem) : null}
          />
        </div>
        <FormError message={error} />
        <div className="flex items-center justify-between pt-4">
          <Link
            href={next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`}
            className="-ml-2 rounded px-2 py-2 text-[14px] font-medium text-[var(--link)] hover:bg-hover"
          >
            Sign in instead
          </Link>
          <button
            type="submit"
            disabled={busy || !email || !username || !password || !birthdate}
            className="btn-blue !normal-case rounded"
          >
            {busy ? "Creating account" : "Create account"}
          </button>
        </div>
      </form>
    </>
  );
}
