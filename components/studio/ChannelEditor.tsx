"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { removeAvatars, resizeAvatar, uploadAvatar } from "@/lib/accounts/avatar";
import { removeBanners, resizeBanner, uploadBanner } from "@/lib/channels/banner";
import type { Channel } from "@/lib/channels/types";
import {
  CHANNEL_DESCRIPTION_MAX,
  CHANNEL_LINKS_MAX,
  CHANNEL_LINK_TITLE_MAX,
  CHANNEL_LINK_URL_MAX,
  CHANNEL_NAME_MAX,
  HANDLE_COOLDOWN_DAYS,
  HANDLE_MAX,
  channelErrorText,
  cooldownText,
  handleCooldown,
  linkProblem,
  normalizeHandle,
  type ChannelLink,
} from "@/lib/channels/validation";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "../Avatar";
import { FormError, TextField } from "../auth/fields";
import { ChannelAbout, ChannelHeader, NoVideos, type ChannelTab } from "../channel/ChannelHeader";
import { handleNote, useHandleCheck } from "./useHandleCheck";

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

const sameLinks = (a: ChannelLink[], b: ChannelLink[]) =>
  a.length === b.length && a.every((l, i) => l.title === b[i].title && l.url === b[i].url);

/**
 * Channel customization: name, handle, description, links, picture and banner,
 * with a live preview that uses the same header as the public page.
 * With `disabled` it renders as a preview (database not connected).
 */
export function ChannelEditor({ channel, disabled }: { channel: Channel; disabled?: boolean }) {
  const router = useRouter();
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(channel.name);
  const [handle, setHandle] = useState(channel.handle);
  const [description, setDescription] = useState(channel.description);
  const [links, setLinks] = useState<ChannelLink[]>(channel.links);
  const [avatarUrl, setAvatarUrl] = useState(channel.avatarUrl);
  const [bannerUrl, setBannerUrl] = useState(channel.bannerUrl);
  const [savedHandle, setSavedHandle] = useState(channel.handle);
  const [handleChangedAt, setHandleChangedAt] = useState(channel.handleChangedAt);

  const [previewTab, setPreviewTab] = useState<ChannelTab>("about");
  const [imageBusy, setImageBusy] = useState<"avatar" | "banner" | null>(null);
  const [imageError, setImageError] = useState<{ which: "avatar" | "banner"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const cooldown = handleCooldown(handleChangedAt);
  const cooldownMessage = cooldownText(cooldown);
  const status = useHandleCheck(handle, savedHandle);
  const note = handleNote(status);
  const wantedHandle = normalizeHandle(handle);
  const handleChanged = wantedHandle !== savedHandle;

  const dirty =
    name !== channel.name || handleChanged || description !== channel.description || !sameLinks(links, channel.links);

  const live: Channel = {
    ...channel,
    name: name.trim() || savedHandle,
    handle: status.state === "invalid" || !wantedHandle ? savedHandle : wantedHandle,
    description: description.trim(),
    links: links.filter((l) => linkProblem(l) === null),
    avatarUrl,
    bannerUrl,
  };

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    setImageError(null);
    const supabase = createClient();
    if (!supabase) return setImageError({ which: "avatar", message: "database not connected" });
    setImageBusy("avatar");
    try {
      const blob = await resizeAvatar(file);
      const url = await uploadAvatar(supabase, channel.ownerId, blob);
      // The channel picture follows the profile picture (a trigger in migration 004).
      const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", channel.ownerId);
      if (error) throw new Error(error.message);
      setAvatarUrl(url);
      router.refresh();
    } catch (e) {
      setImageError({ which: "avatar", message: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setImageBusy(null);
      if (avatarInput.current) avatarInput.current.value = "";
    }
  }

  async function removeAvatar() {
    const supabase = createClient();
    if (!supabase) return;
    setImageBusy("avatar");
    await removeAvatars(supabase, channel.ownerId);
    const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", channel.ownerId);
    setImageBusy(null);
    if (error) return setImageError({ which: "avatar", message: error.message });
    setAvatarUrl(null);
    router.refresh();
  }

  async function pickBanner(file: File | undefined) {
    if (!file) return;
    setImageError(null);
    const supabase = createClient();
    if (!supabase) return setImageError({ which: "banner", message: "database not connected" });
    setImageBusy("banner");
    try {
      const blob = await resizeBanner(file);
      const url = await uploadBanner(supabase, channel.ownerId, blob);
      const { error } = await supabase.from("channels").update({ banner_url: url }).eq("id", channel.id);
      if (error) throw new Error(error.message);
      setBannerUrl(url);
      router.refresh();
    } catch (e) {
      setImageError({ which: "banner", message: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setImageBusy(null);
      if (bannerInput.current) bannerInput.current.value = "";
    }
  }

  async function removeBanner() {
    const supabase = createClient();
    if (!supabase) return;
    setImageBusy("banner");
    await removeBanners(supabase, channel.ownerId);
    const { error } = await supabase.from("channels").update({ banner_url: null }).eq("id", channel.id);
    setImageBusy(null);
    if (error) return setImageError({ which: "banner", message: error.message });
    setBannerUrl(null);
    router.refresh();
  }

  function setLink(i: number, patch: Partial<ChannelLink>) {
    setLinks((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (handleChanged && !cooldown.canChange) return setError(cooldownMessage);
    if (status.state === "invalid" || status.state === "taken") return setError(note.error!);
    if (name.trim().length > CHANNEL_NAME_MAX) return setError(`Use at most ${CHANNEL_NAME_MAX} characters for the name.`);
    if (description.length > CHANNEL_DESCRIPTION_MAX) {
      return setError(`Use at most ${CHANNEL_DESCRIPTION_MAX} characters for the description.`);
    }
    const kept = links.filter((l) => l.title.trim() || l.url.trim());
    for (const link of kept) {
      const problem = linkProblem(link);
      if (problem) return setError(problem);
    }
    const supabase = createClient();
    if (!supabase) return setError("database not connected");

    setBusy(true);
    if (handleChanged) {
      const { data, error } = await supabase.rpc("set_channel_handle", { new_handle: wantedHandle });
      if (error) {
        setBusy(false);
        if (error.message.includes("handle_cooldown") && error.details) {
          setHandleChangedAt(new Date(new Date(error.details).getTime() - HANDLE_COOLDOWN_DAYS * 86400000).toISOString());
        }
        return setError(channelErrorText(error.message));
      }
      setSavedHandle(typeof data === "string" ? data : wantedHandle);
      setHandleChangedAt(new Date().toISOString());
    }

    const { error } = await supabase
      .from("channels")
      .update({
        name: name.trim() || savedHandle,
        description: description.trim(),
        links: kept.map((l) => ({ title: l.title.trim(), url: l.url.trim() })),
      })
      .eq("id", channel.id);
    setBusy(false);
    if (error) return setError(channelErrorText(error.message));
    setSaved(true);
    router.refresh();
  }

  return (
    <div>
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[12px] font-medium uppercase tracking-[0.5px] text-text-2">Live preview</h2>
          {!disabled && (
            <Link href={`/@${savedHandle}`} className="link text-[14px]">
              View channel
            </Link>
          )}
        </div>
        <div className="overflow-hidden rounded-sm border border-divider bg-page">
          <ChannelHeader
            channel={live}
            tab={previewTab}
            isOwner
            preview
            onTab={setPreviewTab}
            bannerPlaceholder="No banner yet"
          />
          {previewTab === "about" ? <ChannelAbout channel={live} /> : <NoVideos isOwner />}
        </div>
      </div>

      <div className="bg-surface px-4 sm:px-8">
        <Section title="Banner image" description="PNG, JPG or WebP, up to 6 MB. Cropped to 2560 x 423 and saved as WebP.">
          <div className="flex flex-wrap gap-2">
            <input
              ref={bannerInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => pickBanner(e.target.files?.[0])}
            />
            <button
              type="button"
              disabled={disabled || imageBusy !== null}
              onClick={() => bannerInput.current?.click()}
              className="btn-blue"
            >
              {imageBusy === "banner" ? "Uploading" : bannerUrl ? "Change" : "Upload"}
            </button>
            {bannerUrl && (
              <button type="button" disabled={disabled || imageBusy !== null} onClick={removeBanner} className="btn-text">
                Remove
              </button>
            )}
          </div>
          <p className="mt-2 text-[13px] text-text-2">On phones the whole banner shows, with bars above and below.</p>
          {imageError?.which === "banner" && (
            <p role="alert" className="mt-3 text-[13px] text-error">
              {imageError.message}
            </p>
          )}
        </Section>

        <Section title="Picture" description="Your channel and your account share one picture. PNG, JPG or WebP, up to 2 MB.">
          <div className="flex items-center gap-6">
            <Avatar name={live.name} url={avatarUrl} size={80} />
            <div className="flex flex-wrap gap-2">
              <input
                ref={avatarInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => pickAvatar(e.target.files?.[0])}
              />
              <button
                type="button"
                disabled={disabled || imageBusy !== null}
                onClick={() => avatarInput.current?.click()}
                className="btn-blue"
              >
                {imageBusy === "avatar" ? "Uploading" : "Change"}
              </button>
              {avatarUrl && (
                <button type="button" disabled={disabled || imageBusy !== null} onClick={removeAvatar} className="btn-text">
                  Remove
                </button>
              )}
            </div>
          </div>
          {imageError?.which === "avatar" && (
            <p role="alert" className="mt-3 text-[13px] text-error">
              {imageError.message}
            </p>
          )}
        </Section>

        <form onSubmit={save}>
          <Section title="Name and handle" description="Your channel name and handle are public.">
            <div className="max-w-[440px] space-y-5">
              <TextField
                label="Channel name"
                value={name}
                maxLength={CHANNEL_NAME_MAX}
                disabled={disabled}
                onChange={(e) => setName(e.target.value)}
              />
              <TextField
                label="Handle"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={HANDLE_MAX + 1}
                value={handle}
                disabled={disabled || !cooldown.canChange}
                onChange={(e) => setHandle(e.target.value)}
                hint={
                  cooldownMessage ??
                  (note.hint === "Available" || note.hint === "Your current handle"
                    ? `${note.hint}. Your channel lives at /@${live.handle}`
                    : note.hint)
                }
                error={note.error}
              />
              {cooldown.canChange && (
                <p className="px-1 text-[12px] leading-4 text-text-2">
                  After a change you have to wait {HANDLE_COOLDOWN_DAYS} days before changing it again.
                </p>
              )}
            </div>
          </Section>

          <Section title="Description" description="Shown on the About tab.">
            <div className="max-w-[560px]">
              <textarea
                aria-label="Description"
                className="field min-h-[120px] text-[14px]"
                maxLength={CHANNEL_DESCRIPTION_MAX}
                value={description}
                disabled={disabled}
                onChange={(e) => setDescription(e.target.value)}
              />
              <p className="mt-1 text-right text-[12px] text-text-2">
                {description.length}/{CHANNEL_DESCRIPTION_MAX}
              </p>
            </div>
          </Section>

          <Section title="Links" description={`Up to ${CHANNEL_LINKS_MAX} links on the About tab. https only.`}>
            <div className="max-w-[560px] space-y-4">
              {links.map((link, i) => (
                <div key={i} className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="sm:w-[180px]">
                    <TextField
                      label="Title"
                      value={link.title}
                      maxLength={CHANNEL_LINK_TITLE_MAX}
                      disabled={disabled}
                      onChange={(e) => setLink(i, { title: e.target.value })}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <TextField
                      label="URL"
                      type="url"
                      inputMode="url"
                      value={link.url}
                      maxLength={CHANNEL_LINK_URL_MAX}
                      disabled={disabled}
                      onChange={(e) => setLink(i, { url: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setLinks((all) => all.filter((_, j) => j !== i))}
                    className="btn-text self-end sm:self-center"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {links.length < CHANNEL_LINKS_MAX && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setLinks((all) => [...all, { title: "", url: "https://" }])}
                  className="btn-text !px-0 !text-[var(--link)] disabled:opacity-50"
                >
                  Add link
                </button>
              )}
            </div>
          </Section>

          <div className="flex flex-wrap items-center justify-end gap-4 py-4">
            {saved && !dirty && <span className="text-[14px] text-text-2">Saved</span>}
            <FormError message={error} />
            <button type="submit" disabled={disabled || busy || !dirty} className="btn-blue">
              {busy ? "Saving" : "Publish"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
