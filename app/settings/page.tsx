import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DbNotConnected, FeatureOff, FormSkeleton } from "@/components/auth/AuthCard";
import { AddEmail } from "@/components/settings/AddEmail";
import { Connections } from "@/components/settings/Connections";
import { SettingsForm, type SettingsProfile } from "@/components/settings/SettingsForm";
import { accountsState } from "@/lib/accounts/server";
import { connectionState } from "@/lib/yapin/server";

export const metadata = { title: "Settings | sloptube" };

const preview: SettingsProfile = {
  id: "preview",
  email: null,
  username: "your_username",
  displayName: "Your name",
  avatarUrl: null,
  bio: "",
};

async function SettingsGate() {
  const state = await accountsState();
  if (state.kind === "off") return <FeatureOff />;
  if (state.kind === "no-db") {
    return (
      <>
        <DbNotConnected />
        <SettingsForm profile={preview} disabled />
      </>
    );
  }
  const user = state.user;
  if (!user) redirect("/login?next=/settings");
  return (
    <>
      {user.email && (
        <p className="text-[14px] text-text-2">
          Signed in as <span className="text-text">{user.email}</span>
        </p>
      )}
      {user.emailPlaceholder && <AddEmail />}
      <SettingsForm
        profile={{
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          bio: user.bio,
        }}
      />
      <Suspense fallback={null}>
        <YapinConnection />
      </Suspense>
    </>
  );
}

/** Settings > Connections, with the yapin flag on and the Yapin' app set on the server (feature 16). */
async function YapinConnection() {
  const state = await connectionState();
  if (state.kind !== "ready") return null;
  return <Connections linked={state.linked} username={state.username} needsEmail={state.needsEmail} />;
}

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-[1000px] px-4 py-6 sm:px-6">
      <div className="bg-surface px-4 py-6 sm:px-8">
        <h1 className="text-[24px] font-normal leading-8 text-text">Settings</h1>
        <p className="mb-4 mt-1 text-[14px] text-text-2">Choose how you appear on sloptube.</p>
        <Suspense fallback={<FormSkeleton />}>
          <SettingsGate />
        </Suspense>
      </div>
    </div>
  );
}
