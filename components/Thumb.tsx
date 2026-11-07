import Image from "next/image";

/**
 * A video thumbnail with next/image (feature 15): it fills its box (the box
 * sets the size and position: relative), loads lazily unless `eager`, and
 * says how wide it shows with `sizes`.
 *
 * unoptimized: thumbnails come from the video bucket, through /api/media (a
 * redirect to a short lived R2 link) or from MEDIA_PUBLIC_URL, which is read
 * at request time. The image optimizer would need that host frozen into the
 * build and would fetch every thumbnail a second time, so the files are sent
 * as the encoder made them (small WebP, 640 wide).
 */
export function Thumb({ src, alt, sizes, eager = false, className = "" }: { src: string; alt: string; sizes: string; eager?: boolean; className?: string }) {
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      unoptimized
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      className={`object-cover ${className}`}
    />
  );
}

/** How wide a card in the home grid shows (videoGridClass in VideoCard.tsx). */
export const GRID_SIZES = "(min-width: 1800px) 20vw, (min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";
