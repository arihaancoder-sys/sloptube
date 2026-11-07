import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminWords } from "@/components/admin/AdminWords";
import { adminGate, adminWords } from "@/lib/moderation/server";

export const metadata = { title: "Word list | sloptube admin", robots: { index: false } };

async function WordsGate() {
  const gate = await adminGate();
  if (gate.kind === "hidden") notFound();
  const words = await adminWords(gate);
  return (
    <AdminShell
      tab="words"
      title="Word list"
      hint="Comments, video titles and descriptions with one of these as a whole word are refused. A * at the end matches any ending."
      preview={gate.kind === "preview"}
    >
      {"error" in words ? <AdminError code={words.error} /> : <AdminWords words={words} preview={gate.kind === "preview"} />}
    </AdminShell>
  );
}

export default function AdminWordsPage() {
  return (
    <Suspense fallback={null}>
      <WordsGate />
    </Suspense>
  );
}
