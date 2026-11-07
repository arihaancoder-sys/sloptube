import Link from "next/link";
import { PublicPage, Section } from "@/components/launch/PublicPage";

export const metadata = {
  title: "Community Guidelines | sloptube",
  description: "What is and isn't allowed on sloptube, and what happens when something breaks the rules.",
  alternates: { canonical: "/guidelines" },
};

/** /guidelines: the same reasons the Report box offers, explained. */
export default function GuidelinesPage() {
  return (
    <PublicPage
      page="guidelines"
      title="Community Guidelines"
      intro={<p>sloptube is for everyone 13 and older. These rules keep it that way. They cover videos, Snips, thumbnails, titles, comments and channels.</p>}
    >
      <Section id="spam" title="Spam and misleading content">
        <p>No scams, no fake giveaways, no titles or thumbnails that lie about the video, and no posting the same thing over and over. Comments with more than five links are blocked.</p>
      </Section>
      <Section id="sexual" title="Nudity and sexual content">
        <p>No pornography and nothing sexual involving anyone under 18, ever. Accounts that post it are closed.</p>
      </Section>
      <Section id="violent" title="Violent or dangerous content">
        <p>No content that encourages violence, shows real violence to shock, or teaches something that could get people seriously hurt.</p>
      </Section>
      <Section id="harassment" title="Harassment and hate">
        <p>No bullying, threats or sharing someone&apos;s private details. No attacks on people for who they are, such as their race, religion, gender, sexuality or disability.</p>
      </Section>
      <Section id="copyright" title="Copyright">
        <p>Only upload what you made or have permission to use. Rights holders can report a video with &quot;Infringes my rights&quot;.</p>
      </Section>
      <Section title="What happens when something breaks the rules">
        <ul>
          <li>Anyone signed in can report a video, a comment or a channel. Reports go to the site&apos;s admins.</li>
          <li>An admin can remove the content and give the channel a strike. Three strikes in 90 days suspend the channel.</li>
          <li>A removed video can be appealed once from the creator studio.</li>
          <li>Serious or repeated breaks can close the account.</li>
        </ul>
        <p>
          Questions about a decision? Use the <Link href="/contact">contact form</Link>.
        </p>
      </Section>
    </PublicPage>
  );
}
