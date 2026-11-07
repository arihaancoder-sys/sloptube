import Link from "next/link";
import { ContactEmail, Owner, PublicPage, Section } from "@/components/launch/PublicPage";
import { siteConfig } from "@/site.config";

export const metadata = {
  title: "About | sloptube",
  description: "What sloptube is, who runs this copy and how to get in touch.",
  alternates: { canonical: "/about" },
};

/** /about: what the site is and who runs it. */
export default function AboutPage() {
  return (
    <PublicPage
      page="about"
      title="About sloptube"
      intro={<p>A video platform, built in the open one feature at a time.</p>}
    >
      <Section title="What this is">
        <p>
          sloptube is a video site with the feel of 2019 and 2020: channels, uploads, a watch page, a home feed,
          subscriptions, search, likes, comments, Snips, a creator studio, analytics and moderation. Each feature was
          built in its own session and filmed, so the code and the docs are meant to be easy to follow.
        </p>
        <p>
          The code is open source under the MIT license. Anyone can read it, run their own copy or help out on{" "}
          <a href={siteConfig.sourceUrl}>GitHub</a>.
        </p>
      </Section>
      <Section title="Who runs this copy">
        <p>
          This copy of sloptube is run by <Owner value={siteConfig.ownerName} />. They decide what is allowed here,
          following the <Link href="/guidelines">Community Guidelines</Link> and the <Link href="/terms">Terms</Link>.
        </p>
      </Section>
      <Section title="Get in touch">
        <p>
          Write to <ContactEmail /> or use the <Link href="/contact">contact form</Link>. Journalists will find the logo
          and screenshots on the <Link href="/press">press page</Link>.
        </p>
      </Section>
    </PublicPage>
  );
}
