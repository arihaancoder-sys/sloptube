import Link from "next/link";
import { ContactEmail, Owner, PublicPage, Section } from "@/components/launch/PublicPage";
import { siteConfig } from "@/site.config";

export const metadata = {
  title: "Terms of Service | sloptube",
  description: "The rules for using this copy of sloptube.",
  alternates: { canonical: "/terms" },
};

/**
 * /terms: a plain starting point the owner should read and adjust with
 * advice for their own country. It is not legal advice.
 */
export default function TermsPage() {
  const owner = <Owner value={siteConfig.ownerName} />;
  return (
    <PublicPage
      page="terms"
      title="Terms of Service"
      updated
      intro={
        <p>
          These terms are between you and {owner}, who runs this copy of sloptube. By using the site you agree to them.
        </p>
      }
    >
      <Section title="Your account">
        <ul>
          <li>You must be 13 or older to make an account. The site asks for your birthday when you sign up.</li>
          <li>Keep your password to yourself. You are responsible for what happens on your account.</li>
          <li>You can delete your account at any time in Settings. Your videos, comments and channel go with it.</li>
        </ul>
      </Section>
      <Section title="What you upload">
        <ul>
          <li>You keep the rights to your videos, thumbnails and comments.</li>
          <li>
            By uploading, you let {owner} store, process (for example into different qualities) and show your content on
            this site, for as long as it is up. This ends when you delete it, apart from copies in backups that are
            cleared over time.
          </li>
          <li>Only upload what you made yourself or have permission to share.</li>
          <li>
            Everything you post must follow the <Link href="/guidelines">Community Guidelines</Link>.
          </li>
        </ul>
      </Section>
      <Section title="Moderation">
        <p>
          {owner} may remove content, give a strike, suspend a channel or close an account that breaks these terms or the
          guidelines. Three strikes in 90 days suspend a channel. If your video was removed, you can appeal from the
          creator studio.
        </p>
      </Section>
      <Section title="Copyright">
        <p>
          If you think something here infringes your rights, report it with the Report button and pick &quot;Infringes my
          rights&quot;, or write to <ContactEmail /> with a link to the video and what it copies.
        </p>
      </Section>
      <Section title="The service">
        <p>
          sloptube is provided as it is, without any promise that it will always be available or free of mistakes. {owner}{" "}
          may change or stop the service. As far as the law allows, {owner} is not liable for indirect losses from using
          the site.
        </p>
        <p>
          The sloptube software itself is open source under the MIT license; these terms are about using this copy of the
          site, not the code.
        </p>
      </Section>
      <Section title="Changes and law">
        <p>
          When these terms change, the date at the top changes too. Big changes are announced on the site. These terms
          follow the law of <Owner value={siteConfig.jurisdiction} />.
        </p>
        <p>
          Questions? Write to <ContactEmail /> or use the <Link href="/contact">contact form</Link>.
        </p>
      </Section>
    </PublicPage>
  );
}
