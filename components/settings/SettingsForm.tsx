"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { removeAvatars, resizeAvatar, uploadAvatar } from "@/lib/accounts/avatar";
import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  accountErrorText,
  normalizeUsername,
} from "@/lib/accounts/validation";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "../Avatar";
import { FormError, TextField } from "../auth/fields";
import { useUsernameCheck, usernameNote } from "../auth/useUsernameCheck";
import { DeleteAccount } from "./DeleteAccount";

export type SettingsProfile = {
  id: string;
  email: string | null;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
};

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="border-b border-divider py-6 last:border-0 md:grid md:grid-cols-[220px_1fr] md:gap-8">
      <div className="mb-4 md:mb-0">
        <h2 className="text-[16px] font-medium leading-[22px] text-text">{title}</h2>
        {description && <p className="mt-1 text-[13px] leading-[18px] text-text-2">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** The settings form. With `disabled` it renders as a preview (database not connected). */
export function SettingsForm({ profile, disabled }: { profile: SettingsProfile; disabled?: boolean }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const status = useUsernameCheck(username, profile.username);
  const note = usernameNote(status);

  const dirty =
    displayName !== profile.displayName ||
    normalizeUsername(username) !== profile.username ||
    bio !== profile.bio;

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    setAvatarError(null);
    const supabase = createClient();
    if (!supabase) return setAvatarError("database not connected");
    setAvatarBusy(true);
    try {
      const blob = await resizeAvatar(file);
      const url = await uploadAvatar(supabase, profile.id, blob);
      const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", profile.id);
      if (error) throw new Error(error.message);
      setAvatarUrl(url);
      router.refresh();
    } catch (e) {
      setAvatarError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setAvatarBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function removeAvatar() {
    const supabase = createClient();
    if (!supabase) return;
    setAvatarBusy(true);
    await removeAvatars(supabase, profile.id);
    const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", profile.id);
    setAvatarBusy(false);
    if (error) return setAvatarError(error.message);
    setAvatarUrl(null);
    router.refresh();
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (status.state === "invalid" || status.state === "taken") return setError(note.error!);
    if (displayName.trim().length > DISPLAY_NAME_MAX) return setError(`Use at most ${DISPLAY_NAME_MAX} characters for your name.`);
    if (bio.length > BIO_MAX) return setError(`Use at most ${BIO_MAX} characters for your bio.`);
    const supabase = createClient();
    if (!supabase) return setError("database not connected");

    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName.trim(),
        username: normalizeUsername(username),
        bio: bio.trim(),
      })
      .eq("id", profile.id);
    setBusy(false);
    if (error) {
      // 23505 is a unique violation: someone took the name in the meantime.
      return setError(error.code === "23505" ? accountErrorText("username_taken") : accountErrorText(error.message));
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <div>
      <Section title="Picture" description="PNG, JPG or WebP, up to 2 MB. Cropped to a square.">
        <div className="flex items-center gap-6">
          <Avatar name={displayName || profile.username} url={avatarUrl} size={96} />
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => pickAvatar(e.target.files?.[0])}
            />
            <button
              type="button"
              disabled={disabled || avatarBusy}
              onClick={() => fileInput.current?.click()}
              className="btn-blue"
            >
              {avatarBusy ? "Uploading" : "Change"}
            </button>
            {avatarUrl && (
              <button type="button" disabled={disabled || avatarBusy} onClick={removeAvatar} className="btn-text">
                Remove
              </button>
            )}
          </div>
        </div>
        {avatarError && <p role="alert" className="mt-3 text-[13px] text-error">{avatarError}</p>}
      </Section>

      <form onSubmit={save}>
        <Section title="Name and username" description="Your name and username are public.">
          <div className="max-w-[440px] space-y-5">
            <TextField
              label="Name"
              value={displayName}
              maxLength={DISPLAY_NAME_MAX}
              disabled={disabled}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <TextField
              label="Username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={25}
              value={username}
              disabled={disabled}
              onChange={(e) => setUsername(e.target.value)}
              hint={normalizeUsername(username) === profile.username ? "Your current username" : note.hint}
              error={note.error}
            />
          </div>
        </Section>

        <Section title="About" description="Tell viewers about yourself.">
          <div className="max-w-[560px]">
            <textarea
              aria-label="Bio"
              className="field min-h-[120px] text-[14px]"
              maxLength={BIO_MAX}
              value={bio}
              disabled={disabled}
              onChange={(e) => setBio(e.target.value)}
            />
            <p className="mt-1 text-right text-[12px] text-text-2">
              {bio.length}/{BIO_MAX}
            </p>
          </div>
        </Section>

        <div className="flex items-center justify-end gap-4 py-4">
          {saved && !dirty && <span className="text-[14px] text-text-2">Saved</span>}
          <FormError message={error} />
          <button type="submit" disabled={disabled || busy || !dirty} className="btn-blue">
            {busy ? "Saving" : "Save"}
          </button>
        </div>
      </form>

      <Section title="Delete account" description="Removes your profile, picture and sign in for good.">
        <DeleteAccount userId={profile.id} username={profile.username} disabled={disabled} />
      </Section>
    </div>
  );
}
