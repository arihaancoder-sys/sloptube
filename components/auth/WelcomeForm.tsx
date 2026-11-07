"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { accountErrorText, birthdateProblem, normalizeUsername } from "@/lib/accounts/validation";
import { createClient } from "@/lib/supabase/client";
import { BirthdayFields, birthdayValue, emptyBirthday } from "./BirthdayFields";
import { FieldNote, FormError, TextField } from "./fields";
import { useUsernameCheck, usernameNote } from "./useUsernameCheck";

/**
 * Last sign up step for everyone: confirm the username and give a birthday.
 * Calls complete_signup(), which refuses anyone under 13. In that case the
 * account is deleted straight away, so no data about a child is kept.
 */
export function WelcomeForm({ suggested, next }: { suggested: string; next: string }) {
  const router = useRouter();
  const [username, setUsername] = useState(suggested);
  const [birthday, setBirthday] = useState(emptyBirthday);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  // The suggested name is already theirs, so it counts as available.
  const status = useUsernameCheck(username, suggested);
  const birthdate = birthdayValue(birthday);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (status.state === "invalid" || status.state === "taken") return setError(usernameNote(status).error!);
    const supabase = createClient();
    if (!supabase) return setError("database not connected");

    const problem = birthdateProblem(birthdate);
    if (problem && problem !== "too_young") return setError(accountErrorText(problem));

    setBusy(true);
    const { error } = await supabase.rpc("complete_signup", {
      username: normalizeUsername(username),
      birthdate,
    });
    if (error) {
      if (error.message.includes("too_young")) {
        await supabase.rpc("delete_account");
        await supabase.auth.signOut();
        setRefused(true);
        router.refresh();
        return;
      }
      setBusy(false);
      return setError(accountErrorText(error.message));
    }
    router.push(next);
    router.refresh();
  }

  if (refused) {
    return (
      <div role="alert" className="space-y-3 text-[14px] leading-5 text-text">
        <p className="font-medium">You must be 13 or older to use sloptube.</p>
        <p className="text-text-2">Your account has been deleted. You can still watch videos without one.</p>
      </div>
    );
  }

  const note = usernameNote(status);

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <TextField
        label="Username"
        autoCapitalize="none"
        spellCheck={false}
        required
        maxLength={25}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        hint={note.hint}
        error={note.error}
      />
      <div>
        <BirthdayFields value={birthday} onChange={setBirthday} />
        <FieldNote hint="You must be 13 or older. Your birthday is never shown to anyone." />
      </div>
      <FormError message={error} />
      <div className="flex justify-end pt-4">
        <button type="submit" disabled={busy || !username || !birthdate} className="btn-blue !normal-case rounded">
          {busy ? "Saving" : "Continue"}
        </button>
      </div>
    </form>
  );
}
