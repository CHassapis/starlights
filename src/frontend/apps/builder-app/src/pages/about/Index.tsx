import { ExternalLinkIcon, HeartIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Who made what this site is built on, and what this build adds. */
export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-24">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold">About &amp; credits</h1>
        <p className="text-muted-foreground">
          This site is a self-hosted build of Project Starlights for our own table, packaged to run in Docker by C Hassapis. It stands on the work of the people
          below. Thank you to all of them.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="font-heading text-xl font-semibold">Built on</h2>
        <Credit
          name="Project Starlights"
          by="Bas Driessen"
          href="https://github.com/swdriessen/starlights"
          text="The original Starlights: the online character builder, its rules engine and the app this site is based on. Released under the MIT licence, which is kept with this build."
        />
        <Credit
          name="Aurora Builder"
          by="Bas Driessen"
          href="https://www.aurorabuilder.com"
          text="The character builder Starlights continues. Characters, choices and sheets follow how Aurora works, and players' Aurora files can be brought in."
        />
        <Credit
          name="Aurora Legacy"
          by="the Aurora Legacy community"
          href="https://github.com/AuroraLegacy/elements"
          text="The content files (classes, species, backgrounds, feats, spells, items) that keep Aurora, and this builder, up to date."
        />
        <Credit
          name="5etools"
          by="the 5etools community"
          href="https://github.com/5etools-mirror-3/5etools-src"
          text="The data behind the Compendium of Lore and the creatures used in encounters."
        />
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-xl font-semibold">This build adds</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Running it all in Docker on a home server, with nightly content updates, backups and a password for the site; on a self-hosted install the admin's Content page takes the Aurora Legacy and 5etools links and brings everything in</li>
          <li>A step-by-step character wizard for new players, with the books' starting equipment (or gold), placing the portrait on the PDF sheet, and a skip for experienced ones</li>
          <li>Character sheets laid out like Aurora's (on screen and as PDF), bringing in players' Aurora files, multiclassing, and Save / Discard in the builder</li>
          <li>The Battle Action Simulator: attacks, spells, familiars and conditions; magic items under the action they take (wands and staffs cast, potions, charms with charges); preparing spells, and casting one you forgot to prepare</li>
          <li>Campaigns with a DM's view: sessions, NPCs, quests, maps, handouts, magic items to hand out (showing who carries each), and a Gold tab that keeps the party stash</li>
          <li>Encounters run as fights: initiative, monster hit points, and the party's hit points, armor class, passive Perception and conditions straight from their simulators</li>
          <li>Players give each other items and coins from their Equipment tab</li>
          <li>A Homebrew page to make your own magic items and monsters. Homebrew stays off until a player ticks it in their Sources or a DM switches it on for a campaign</li>
          <li>The Compendium of Lore: the books, creatures, spells and items to read and link from campaigns</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-xl font-semibold">Run your own</h2>
        <p className="text-sm text-muted-foreground">
          The code is on{" "}
          <a href="https://github.com/CHassapis/starlights/tree/aurora-server" target="_blank" rel="noreferrer" className="underline">
            GitHub (branch aurora-server)
          </a>
          . Its README explains how to install it with Docker: one script fetches the Aurora Legacy content and the 5etools data and sets everything up.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading text-xl font-semibold">Dungeons &amp; Dragons</h2>
        <p className="text-sm text-muted-foreground">
          Dungeons &amp; Dragons, its rules and its books belong to Wizards of the Coast. This is an unofficial, private fan project for our own games; it is not
          approved or endorsed by Wizards of the Coast. Book content shown here is for the table's private use.
        </p>
      </section>

      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <HeartIcon className="size-4 text-red-500" /> Made with thanks to everyone above.
      </p>
    </div>
  );
}

function Credit({ name, by, href, text }: { name: string; by: string; href: string; text: ReactNode }) {
  return (
    <article className="rounded-lg border p-4">
      <h3 className="font-semibold">
        <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
          {name} <ExternalLinkIcon className="size-3.5" />
        </a>
        <span className="font-normal text-muted-foreground"> by {by}</span>
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </article>
  );
}
