import Link from "next/link";
import { connection } from "next/server";
import { getCurrentUser, toSessionUser } from "@/lib/auth";
import { evaluateAllFlags } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { AvatarMenu } from "./AvatarMenu";
import { DbStatus } from "./DbStatus";
import { AccountCircleIcon, UploadIcon } from "./icons";
import { SessionProvider } from "./SessionProvider";
import { SignedOutMenu } from "./SignedOutMenu";
import { NotificationsBell } from "./subscriptions/NotificationsBell";

const iconLink = "hidden h-10 w-10 place-items-center rounded-full text-icon hover:bg-hover sm:grid";

/**
 * Right side of the top bar. It reads the request (session cookie, flags),
 * so it sits behind a Suspense boundary and streams in. It also hands those
 * values to the browser store for the rest of the page.
 */
export async function TopBarEnd() {
  await connection();
  const config = readSupabaseConfig();
  const user = await getCurrentUser();
  const flags = await evaluateAllFlags(user?.id ?? null);
  const sessionUser = user ? toSessionUser(user) : null;

  return (
    <>
      <SessionProvider config={config} user={sessionUser} flags={flags} />
      {!config && <DbStatus />}
      {flags.upload && (
        <Link
          href={sessionUser ? "/upload" : "/login?next=/upload"}
          prefetch={false}
          aria-label="Upload"
          title="Upload"
          className={iconLink}
        >
          <UploadIcon className="h-6 w-6" />
        </Link>
      )}
      {sessionUser ? (
        <>
          {flags.subscriptions && <NotificationsBell />}
          <AvatarMenu user={sessionUser} email={user?.email ?? null} />
        </>
      ) : (
        <>
          <SignedOutMenu />
          {flags.accounts && <SignInButton />}
        </>
      )}
    </>
  );
}

export function SignInButton() {
  return (
    <Link
      href="/login"
      aria-label="Sign in"
      className="ml-1 inline-flex h-9 shrink-0 items-center gap-2 rounded-[2px] border border-[var(--link)] px-[11px] text-[14px] font-medium uppercase text-[var(--link)]"
    >
      <AccountCircleIcon className="h-6 w-6" />
      <span className="hidden sm:inline">Sign in</span>
    </Link>
  );
}
