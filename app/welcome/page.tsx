import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard, DbNotConnected, FeatureOff, FormSkeleton } from "@/components/auth/AuthCard";
import { WelcomeForm } from "@/components/auth/WelcomeForm";
import { safeNext } from "@/lib/accounts/redirect";
import { accountsState } from "@/lib/accounts/server";

export const metadata = { title: "Finish signing up | sloptube" };

async function WelcomeGate({ searchParams }: { searchParams: PageProps<"/welcome">["searchParams"] }) {
  const next = safeNext((await searchParams).next);
  const state = await accountsState();
  if (state.kind === "no-db") return <DbNotConnected />;
  if (state.kind === "off") return <FeatureOff />;
  if (!state.user) redirect("/login?next=/welcome");
  if (state.user.onboarded) redirect(next);
  return <WelcomeForm suggested={state.user.username} next={next} />;
}

export default function WelcomePage({ searchParams }: PageProps<"/welcome">) {
  return (
    <AuthCard title="One more step" subtitle="Pick your username and tell us your birthday">
      <Suspense fallback={<FormSkeleton />}>
        <WelcomeGate searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}
