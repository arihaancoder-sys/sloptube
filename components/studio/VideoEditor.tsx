"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { DESCRIPTION_MAX, TITLE_MAX } from "@/lib/upload/rules";
import { parseTags, studioErrorMessage, TAGS_MAX, tagsProblem, thumbnailFileProblem } from "@/lib/studio/rules";
import type { CommentsMode, StudioRow, Visibility } from "@/lib/studio/types";
import { formatTime } from "@/lib/watch/format";
import { ArrowBackIcon, CheckIcon, CloseIcon, EyeIcon, ImageIcon, LinkIcon, LockIcon } from "../icons";

export type Still = { name: string; url: string };

const VIS: { value: Visibility; label: string; hint: string; Icon: typeof EyeIcon }[] = [
  { value: "public", label: "Public", hint: "Everyone can watch your video", Icon: EyeIcon },
  { value: "unlisted", label: "Unlisted", hint: "Anyone with the link can watch your video", Icon: LinkIcon },
  { value: "private", label: "Private", hint: "Only you can watch your video", Icon: LockIcon },
];

const MODES: { value: CommentsMode | null; label: string }[] = [
  { value: null, label: "Follow the channel default" },
  { value: "on", label: "Allow all comments" },
  { value: "held", label: "Hold all comments for review" },
  { value: "off", label: "Turn off comments" },
];

function Box({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-[15px] font-medium leading-6 text-text">{title}</h2>
      {hint && <p className="mb-3 text-[13px] leading-[18px] text-text-2">{hint}</p>}
      {children}
    </section>
  );
}

/** An outlined box with the label inside at the top, like the 2020 Studio fields. */
function Field({ label, count, max, error, children }: { label: string; count?: number; max?: number; error?: string | null; children: ReactNode }) {
  return (
    <label
      className={`mb-6 block rounded-[4px] border px-3 pb-1.5 pt-2 focus-within:border-[var(--studio-accent)] ${
        error ? "border-[var(--error)]" : "border-[var(--input-border)]"
      }`}
    >
      <span className="block text-[12px] leading-4 text-text-2">{label}</span>
      {children}
      {(max !== undefined || error) && (
        <span className="flex justify-between gap-4 text-[12px] leading-4">
          <span className="text-[var(--error)]">{error}</span>
          {max !== undefined && <span className={(count ?? 0) > max ? "text-[var(--error)]" : "text-text-3"}>{`${count ?? 0}/${max}`}</span>}
        </span>
      )}
    </label>
  );
}

async function post(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.error === "string") throw new Error(typeof json.error === "string" ? json.error : "failed");
  return json;
}

/**
 * The 2020 "Video details" page: title, description, thumbnail, tags,
 * comments and the Snip choice on the left; the preview and visibility on
 * the right. Thumbnails save as soon as they are picked; the rest on Save.
 */
export function VideoEditor({
  video,
  stills,
  custom,
  channelDefault,
  commentsOn,
  shortsOn,
  uploadsConfigured,
  preview,
  statsOn = false,
}: {
  video: StudioRow;
  stills: Still[];
  custom: Still | null;
  channelDefault: CommentsMode;
  commentsOn: boolean;
  shortsOn: boolean;
  uploadsConfigured: boolean;
  preview?: boolean;
  /** The Analytics link next to Save, with the stats flag. */
  statsOn?: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const start = {
    title: video.title,
    description: video.description,
    visibility: video.visibility,
    tags: video.tags.join(", "),
    mode: video.commentsMode,
    short: video.shortChoice ?? video.isShort,
  };
  const [saved, setSaved] = useState(start);
  const [title, setTitle] = useState(start.title);
  const [description, setDescription] = useState(start.description);
  const [visibility, setVisibility] = useState<Visibility>(start.visibility);
  const [tagText, setTagText] = useState(start.tags);
  const [mode, setMode] = useState<CommentsMode | null>(start.mode);
  const [short, setShort] = useState(start.short);
  const [thumb, setThumb] = useState<string>(video.thumbnailName ?? "thumb-1.webp");
  const [thumbUrl, setThumbUrl] = useState<string | null>(video.thumbnail);
  const [customStill, setCustomStill] = useState<Still | null>(custom);
  const [thumbBusy, setThumbBusy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const tags = parseTags(tagText);
  const tagError = tagsProblem(tags);
  const cleanTitle = title.trim();
  const titleError = cleanTitle.length === 0 ? "Your video needs a title" : cleanTitle.length > TITLE_MAX ? `Up to ${TITLE_MAX} characters` : null;
  const descError = description.length > DESCRIPTION_MAX ? `Up to ${DESCRIPTION_MAX.toLocaleString("en-US")} characters` : null;
  const dirty =
    title !== saved.title ||
    description !== saved.description ||
    visibility !== saved.visibility ||
    tags.join(",") !== parseTags(saved.tags).join(",") ||
    mode !== saved.mode ||
    short !== saved.short;
  const canSave = dirty && !busy && !titleError && !descError && !tagError && !preview;
  const ready = video.status === "ready";
  const canBeShort = video.isShort || video.shortChoice === false;

  function undo() {
    setTitle(saved.title);
    setDescription(saved.description);
    setVisibility(saved.visibility);
    setTagText(saved.tags);
    setMode(saved.mode);
    setShort(saved.short);
    setError(null);
  }

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    setNote(null);
    // Each part is marked saved as soon as it went through, so a later failure
    // leaves only what is really unsaved for the next try.
    let done = saved;
    try {
      await post("/api/studio/video", { videoId: video.id, title: cleanTitle, description, visibility, tags });
      done = { ...done, title: cleanTitle, description, visibility, tags: tags.join(", ") };
      setTitle(cleanTitle);
      setTagText(done.tags);
      setSaved(done);
      if (commentsOn && mode !== saved.mode) {
        await post("/api/comments/settings", { videoId: video.id, mode });
        done = { ...done, mode };
        setSaved(done);
      }
      if (shortsOn && canBeShort && short !== saved.short) {
        await post("/api/shorts/choice", { videoId: video.id, on: short });
        done = { ...done, short };
        setSaved(done);
      }
      setNote("Changes saved");
      router.refresh();
    } catch (e) {
      setError(studioErrorMessage(e instanceof Error ? e.message : "failed"));
    } finally {
      setBusy(false);
    }
  }

  async function pickStill(name: string) {
    if (preview || thumbBusy || name === thumb) return;
    setThumbBusy(name);
    setError(null);
    try {
      const out = await post("/api/studio/thumbnail", { videoId: video.id, still: name === "thumb-1.webp" ? null : name });
      setThumb(name);
      setThumbUrl((out.url as string | null) ?? stills.find((s) => s.name === name)?.url ?? null);
      setNote("Thumbnail saved");
    } catch (e) {
      setError(studioErrorMessage(e instanceof Error ? e.message : "failed"));
    } finally {
      setThumbBusy(null);
    }
  }

  async function upload(file: File) {
    const problem = thumbnailFileProblem(file);
    if (problem) return setError(problem);
    setThumbBusy("custom");
    setError(null);
    try {
      const sign = await post("/api/studio/thumbnail/sign", { videoId: video.id, mime: file.type, bytes: file.size });
      const put = await fetch(String(sign.url), { method: "PUT", headers: { "content-type": file.type }, body: file });
      if (!put.ok) throw new Error("upload_failed");
      const name = String(sign.name);
      const out = await post("/api/studio/thumbnail", { videoId: video.id, uploaded: name });
      const url = (out.url as string | null) ?? URL.createObjectURL(file);
      setCustomStill({ name, url });
      setThumb(name);
      setThumbUrl(url);
      setNote("Thumbnail saved");
    } catch (e) {
      setError(studioErrorMessage(e instanceof Error ? e.message : "upload_failed"));
    } finally {
      setThumbBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const tiles: Still[] = [...(customStill ? [customStill] : []), ...stills];
  const watchHref = video.isShort ? `/shorts/${video.id}` : `/watch?v=${video.id}`;

  return (
    <div data-video-editor={video.id}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/studio/content" aria-label="Back to channel content" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-icon hover:bg-hover">
            <ArrowBackIcon className="h-6 w-6" />
          </Link>
          <h1 className="truncate text-[24px] font-normal leading-8 text-text">Video details</h1>
        </div>
        <div className="flex items-center gap-2">
          {statsOn && (
            <Link href={`/studio/video/${video.id}/analytics`} className="btn-text" data-analytics-link>
              Analytics
            </Link>
          )}
          <button type="button" className="btn-text" disabled={!dirty || busy} onClick={undo} data-undo>
            Undo changes
          </button>
          <button type="button" className="btn-blue" disabled={!canSave} onClick={save} data-save>
            {busy ? "Saving" : "Save"}
          </button>
        </div>
      </div>

      {(error || note) && (
        <p role={error ? "alert" : "status"} className={`mb-4 text-[14px] ${error ? "text-[var(--error)]" : "text-text-2"}`} data-editor-message>
          {error ?? note}
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <Field label="Title (required)" count={title.length} max={TITLE_MAX} error={titleError}>
            <textarea
              value={title}
              rows={2}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
              disabled={preview}
              className="mt-1 block w-full resize-none bg-transparent text-[15px] leading-[22px] text-text outline-none"
              data-field="title"
            />
          </Field>
          <Field label="Description" count={description.length} max={DESCRIPTION_MAX} error={descError}>
            <textarea
              value={description}
              rows={7}
              onChange={(e) => setDescription(e.target.value)}
              disabled={preview}
              placeholder="Tell viewers about your video"
              className="mt-1 block w-full resize-y bg-transparent text-[15px] leading-[22px] text-text outline-none placeholder:text-text-3"
              data-field="description"
            />
          </Field>

          <Box
            title="Thumbnail"
            hint={ready ? "Pick a still from your video or upload your own. Thumbnails save right away." : "Thumbnails can be changed once the video is processed."}
          >
            <div className="flex flex-wrap gap-3" data-thumbnails>
              {ready && (
                <button
                  type="button"
                  disabled={preview || !uploadsConfigured || thumbBusy !== null}
                  onClick={() => fileInput.current?.click()}
                  title={uploadsConfigured ? "Upload a JPG, PNG or WebP up to 2 MB" : "Uploads aren't configured on this server"}
                  className="grid aspect-video w-[140px] place-items-center rounded-[2px] border border-dashed border-[var(--input-border)] text-[12px] text-text-2 hover:bg-hover disabled:opacity-50"
                  data-upload-thumbnail
                >
                  <span className="flex flex-col items-center gap-1">
                    <ImageIcon className="h-6 w-6" />
                    {thumbBusy === "custom" ? "Uploading" : "Upload thumbnail"}
                  </span>
                </button>
              )}
              {tiles.map((s) => {
                const on = thumb === s.name;
                return (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => pickStill(s.name)}
                    disabled={preview || thumbBusy !== null || s.name.startsWith("custom-")}
                    aria-pressed={on}
                    aria-label={s.name.startsWith("custom-") ? "Your thumbnail" : `Still ${s.name.slice(6, 7)}`}
                    data-still={s.name}
                    className={`relative aspect-video w-[140px] overflow-hidden rounded-[2px] outline-offset-2 ${on ? "outline outline-2 outline-[var(--studio-accent)]" : "opacity-80 hover:opacity-100"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.url} alt="" className="h-full w-full bg-black object-cover" />
                    {on && (
                      <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-[var(--studio-accent)] text-white">
                        <CheckIcon className="h-4 w-4" />
                      </span>
                    )}
                    {thumbBusy === s.name && <span className="absolute inset-0 grid place-items-center bg-black/50 text-[12px] text-white">Saving</span>}
                  </button>
                );
              })}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
          </Box>

          <Box title="Tags" hint={`Tags help people find your video when they misspell a word. Separate them with commas, up to ${TAGS_MAX}.`}>
            <Field label="Tags" error={tagError}>
              <input
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
                disabled={preview}
                placeholder="Add tag"
                className="mt-1 block h-7 w-full bg-transparent text-[15px] text-text outline-none placeholder:text-text-3"
                data-field="tags"
              />
            </Field>
            {tags.length > 0 && (
              <ul className="-mt-4 mb-2 flex flex-wrap gap-2" data-tag-chips>
                {tags.map((t) => (
                  <li key={t} className="flex h-7 items-center gap-1 rounded-full bg-hover pl-3 pr-1 text-[13px] text-text">
                    {t}
                    <button
                      type="button"
                      aria-label={`Remove ${t}`}
                      disabled={preview}
                      onClick={() => setTagText(tags.filter((x) => x !== t).join(", "))}
                      className="grid h-5 w-5 place-items-center rounded-full text-text-2 hover:bg-[var(--active)]"
                    >
                      <CloseIcon className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Box>

          {commentsOn && (
            <Box title="Comments" hint={`The channel default is ${channelDefault === "held" ? "hold all for review" : channelDefault === "off" ? "off" : "allow all"}.`}>
              <div className="grid gap-1" role="radiogroup" aria-label="Comments" data-comments-mode>
                {MODES.map((m) => (
                  <label key={String(m.value)} className="flex h-9 cursor-pointer items-center gap-3 text-[14px] text-text">
                    <input
                      type="radio"
                      name="comments-mode"
                      checked={mode === m.value}
                      onChange={() => setMode(m.value)}
                      disabled={preview}
                      className="h-[18px] w-[18px] accent-[var(--studio-accent)]"
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </Box>
          )}

          {shortsOn && (
            <Box title="Snips" hint="Vertical videos of 60 seconds or less show up in Snips.">
              {canBeShort ? (
                <label className="flex cursor-pointer items-center gap-3 text-[14px] text-text">
                  <input
                    type="checkbox"
                    checked={short}
                    onChange={() => setShort(!short)}
                    disabled={preview}
                    className="h-[18px] w-[18px] accent-[var(--studio-accent)]"
                    data-field="short"
                  />
                  Show this video as a Snip
                </label>
              ) : (
                <p className="text-[14px] text-text-2">This video is not vertical and 60 seconds or less, so it stays a regular video.</p>
              )}
            </Box>
          )}
        </div>

        <aside className="min-w-0">
          <div className="overflow-hidden rounded-[2px] bg-surface shadow-[0_0_0_1px_var(--divider)]">
            <div className="relative bg-black">
              {thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbUrl} alt="" className="aspect-video w-full object-cover" data-preview-thumbnail />
              ) : (
                <div className="grid aspect-video w-full place-items-center text-[13px] text-white/60">
                  {ready ? "" : video.status === "failed" ? "Processing failed" : "Processing"}
                </div>
              )}
              {video.durationS ? (
                <span className="absolute bottom-2 right-2 rounded-[2px] bg-black/80 px-1 text-[12px] font-medium text-white">
                  {formatTime(video.durationS)}
                </span>
              ) : null}
            </div>
            <div className="px-4 py-3 text-[13px]">
              <p className="text-text-2">Video link</p>
              <Link href={watchHref} className="block truncate text-[var(--studio-accent)] hover:underline">
                {watchHref}
              </Link>
              <p className="mt-3 text-text-2">Title</p>
              <p className="line-clamp-2 text-text">{cleanTitle || "Untitled"}</p>
            </div>
          </div>

          <div className="mt-6">
            <h2 className="mb-2 text-[15px] font-medium text-text">Visibility</h2>
            <div className="rounded-[2px] border border-divider bg-surface" role="radiogroup" aria-label="Visibility" data-visibility-choice>
              {VIS.map((v) => (
                <label key={v.value} className="flex cursor-pointer items-start gap-3 border-b border-divider px-4 py-3 last:border-0">
                  <input
                    type="radio"
                    name="visibility"
                    value={v.value}
                    checked={visibility === v.value}
                    onChange={() => setVisibility(v.value)}
                    disabled={preview}
                    className="mt-0.5 h-[18px] w-[18px] accent-[var(--studio-accent)]"
                  />
                  <span>
                    <span className="flex items-center gap-1.5 text-[14px] text-text">
                      <v.Icon className="h-4 w-4 text-icon" />
                      {v.label}
                    </span>
                    <span className="text-[12px] text-text-2">{v.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
