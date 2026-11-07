import { YapinIcon } from "../icons";

/**
 * Continue with Yapin' (feature 16). A plain link: /auth/yapin/start sets the
 * state cookie and sends people to yapin.gg. Only shown when the yapin flag is
 * on and the Yapin' app is set on the server.
 */
export function YapinButton({ next }: { next: string }) {
  const href = `/auth/yapin/start${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`;
  return (
    <a
      href={href}
      data-yapin-signin
      className="mt-3 flex h-10 w-full items-center justify-center gap-3 rounded border border-[#dadce0] bg-surface text-[14px] font-medium text-[#3c4043] hover:bg-[#f8faff] dark:border-[#5f6368] dark:text-[#e8eaed] dark:hover:bg-hover"
    >
      <YapinIcon className="h-[18px] w-[18px]" />
      Continue with Yapin&apos;
    </a>
  );
}
