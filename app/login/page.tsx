import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard, DbNotConnected, FeatureOff, FormSkeleton } from "@/components/auth/AuthCard";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeNext } from "@/lib/accounts/redirect";
import { accountsState } from "@/lib/accounts/server";
import { yapinNote } from "@/lib/yapin/rules";
import { yapinSignIn } from "@/lib/yapin/server";

export const metadata = { title: "Sign in | sloptube" };

const callbackError = "Sign in did not finish. Try again.";
/** proxy.ts sends a banned account here once it has signed it out (feature 14). */
const bannedError = "This account has been banned for breaking the rules.";

async function LoginGate({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const state = await accountsState();
  if (state.kind === "no-db") return <DbNotConnected />;
  if (state.kind === "off") return <FeatureOff />;
  if (state.user) redirect(state.user.onboarded ? next : "/welcome");
  const yapin = (await yapinSignIn(null)) !== null;
  const note = typeof params.yapin === "string" ? yapinNote(params.yapin) : null;
  return (
    <LoginForm
      next={next}
      yapin={yapin}
      initialError={params.banned ? bannedError : params.error ? callbackError : note}
    />
  );
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthCard title="Sign in" subtitle="to continue to sloptube">
      <Suspense fallback={<FormSkeleton />}>
        <LoginGate searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}
