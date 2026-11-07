import Image from "next/image";

// The 2019 default avatar: the first letter on a colored circle.
const colors = ["#ef6c00", "#5e35b1", "#00897b", "#3949ab", "#c2185b", "#7cb342", "#6d4c41", "#039be5"];

function colorFor(seed: string) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

export function Avatar({
  name,
  url,
  size = 32,
  alt = "",
}: {
  name: string;
  url?: string | null;
  size?: number;
  /** Empty when the name is written next to it (the usual case); else the name. */
  alt?: string;
}) {
  if (url) {
    return (
      // unoptimized: avatars come from Supabase Storage, already cropped and
      // resized to 176 px by us, and the Supabase address is only known at
      // request time (see Thumb.tsx).
      <Image
        src={url}
        alt={alt}
        width={size}
        height={size}
        sizes={`${size}px`}
        unoptimized
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-normal uppercase text-white"
      style={{ width: size, height: size, background: colorFor(name), fontSize: size * 0.5 }}
    >
      {name.trim().charAt(0) || "?"}
    </span>
  );
}
