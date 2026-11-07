import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard, DbNotConnected, FeatureOff, FormSkeleton } from "@/components/auth/AuthCard";
import { SignupForm } from "@/components/auth/SignupForm";
import { safeNext } from "@/lib/accounts/redirect";
import { accountsState } from "@/lib/accounts/server";
import { yapinSignIn } from "@/lib/yapin/server";

export const metadata = { title: "Create your account | sloptube" };

async function SignupGate({ searchParams }: { searchParams: PageProps<"/signup">["searchParams"] }) {
  const next = safeNext((await searchParams).next);
  const state = await accountsState();
  if (state.kind === "no-db") return <DbNotConnected />;
  if (state.kind === "off") return <FeatureOff />;
  if (state.user) redirect(state.user.onboarded ? next : "/welcome");
  const yapin = (await yapinSignIn(null)) !== null;
  return <SignupForm next={next} yapin={yapin} />;
}

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <AuthCard title="Create your account" subtitle="to continue to sloptube">
      <Suspense fallback={<FormSkeleton />}>
        <SignupGate searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}
