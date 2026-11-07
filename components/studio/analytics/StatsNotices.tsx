import Link from "next/link";
import { ChannelMessage } from "../../channel/ChannelNotices";

export function StatsOff() {
  return (
    <div data-studio-state="stats-off">
      <ChannelMessage state="off" title="Analytics are coming soon">
        Views, watch time, subscribers, audience retention and traffic sources for your channel and every video. Until then, the{" "}
        <Link href="/studio" className="text-[var(--link)]">
          dashboard
        </Link>{" "}
        has your latest numbers.
      </ChannelMessage>
    </div>
  );
}

export function StatsNotSetUp() {
  return (
    <div data-studio-state="not-set-up">
      <ChannelMessage state="not-set-up" title="Analytics aren't set up yet">
        Run <code>supabase/migrations/015_stats.sql</code> in the Supabase SQL editor, then reload.
      </ChannelMessage>
    </div>
  );
}

export function StatsError({ message }: { message: string }) {
  return (
    <div data-studio-state="error">
      <ChannelMessage state="error" title="Analytics didn't load">
        {message}
      </ChannelMessage>
    </div>
  );
}
