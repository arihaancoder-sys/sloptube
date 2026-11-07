import Link from "next/link";
import { ContactEmail, Owner, PublicPage, Section } from "@/components/launch/PublicPage";
import { siteConfig } from "@/site.config";

export const metadata = {
  title: "Privacy | sloptube",
  description: "What this copy of sloptube stores about you, why, and how to get it removed.",
  alternates: { canonical: "/privacy" },
};

/** /privacy: what the code actually stores, feature by feature. */
export default function PrivacyPage() {
  return (
    <PublicPage
      page="privacy"
      title="Privacy"
      updated
      intro={
        <p>
          This page says what this copy of sloptube, run by <Owner value={siteConfig.ownerName} />, stores about you and
          why. There are no ads and no third party trackers.
        </p>
      }
    >
      <Section title="What we store">
        <ul>
          <li>
            <strong>Your account:</strong> email address, name, username, picture, bio and birthday. The birthday is only
            used to check that you are 13 or older and is never shown.
          </li>
          <li>
            <strong>Your channel and videos:</strong> what you upload and type in, plus the processed copies of your videos.
          </li>
          <li>
            <strong>What you do:</strong> likes, subscriptions, comments, reports, your watch history and where you stopped
            in a video. You can clear or pause your history at any time in History.
          </li>
          <li>
            <strong>Views:</strong> view counts and watch time for the creator&apos;s analytics. Signed out views are
            counted with a random id kept in your browser, not your name.
          </li>
          <li>
            <strong>Messages:</strong> what you send with the <Link href="/contact">contact form</Link>, with your name and
            email address so we can reply.
          </li>
        </ul>
      </Section>
      <Section title="Network addresses">
        <p>
          To stop abuse, searches and the contact form are limited per network address. For the contact form only a
          scrambled (hashed) form of the address is kept. The server logs that every web server writes are cleared
          regularly.
        </p>
      </Section>
      <Section title="Cookies">
        <p>
          sloptube uses cookies only to keep you signed in. Your theme and player settings (volume, quality) are kept in
          your own browser.
        </p>
      </Section>
      <Section title="Who else sees it">
        <p>
          The site runs on rented servers and services that store data on our behalf: the database and sign in (Supabase),
          video files (Cloudflare R2) and the network in front of the site (Cloudflare). Nothing is sold or shared for
          advertising.
        </p>
      </Section>
      <Section title="Your choices">
        <ul>
          <li>Change your details in Settings, and delete your account there. Your data goes with it.</li>
          <li>
            To get a copy of your data or to ask anything about it, write to <ContactEmail />.
          </li>
        </ul>
      </Section>
    </PublicPage>
  );
}
