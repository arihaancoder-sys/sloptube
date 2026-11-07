import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Uploader } from "@/components/upload/Uploader";
import { UploadSkeleton, UploadsOff } from "@/components/upload/UploadNotices";
import { uploadPageState } from "@/lib/upload/server";

export const metadata = { title: "Upload videos | sloptube" };

async function UploadGate() {
  const state = await uploadPageState();
  switch (state.kind) {
    case "preview":
      return <Uploader configured={false} preview />;
    case "off":
      return <UploadsOff noDb={state.noDb} />;
    case "signed-out":
      redirect("/login?next=/upload");
    case "not-onboarded":
      redirect("/welcome?next=/upload");
    case "ready":
      return <Uploader configured={state.configured} />;
  }
}

export default function UploadPage() {
  return (
    <Suspense fallback={<UploadSkeleton />}>
      <UploadGate />
    </Suspense>
  );
}
