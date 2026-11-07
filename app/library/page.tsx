import { EmptyState } from "@/components/EmptyState";

export const metadata = { title: "Library | sloptube" };

export default function Library() {
  return (
    <EmptyState
      title="Your library is empty."
      hint="Videos you watch show up in History, and the channels you follow in Subscriptions."
      cards={0}
    />
  );
}
