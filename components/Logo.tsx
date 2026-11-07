import Link from "next/link";
import { LogoMark } from "./icons";

/** The green slop mark and the two tone wordmark: "slop" in green, "tube" in the text color. */
export function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onClick}
      aria-label="sloptube home"
      className="flex h-14 items-center gap-1 pl-4 pr-3"
    >
      <LogoMark className="h-7 w-7" />
      <span className="text-[20px] font-bold leading-none tracking-[-0.9px] text-text">
        <span className="text-[var(--logo-word)]">slop</span>tube
      </span>
    </Link>
  );
}
