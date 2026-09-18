/**
 * The Managing Director's welcome, on a new joiner's first screen.
 *
 * This is the one card on the portal that is not a control. Everything around it counts
 * something or asks for something; this is a person speaking to a person on what is
 * often their first morning, and rendering it as another white panel in the stack makes
 * it read like a notice rather than a welcome.
 *
 * The variants below are the same content in four presentations. `WELCOME_VARIANTS` is
 * the list the firm chooses from; `variant` picks one.
 */

import { Markdown } from "./Markdown";

export const WELCOME_VARIANTS = ["letter", "masthead", "quiet", "portrait"] as const;
export type WelcomeVariant = (typeof WELCOME_VARIANTS)[number];

export interface WelcomeCardProps {
  body: string;
  firmName: string;
  mdName: string;
  mdTitle: string;
  variant?: WelcomeVariant;
}

/**
 * The title this firm gives the person signing, for the line above the letter.
 *
 * Read from the firm's settings rather than written in, because it is already editable
 * under Portal settings and the signature at the foot has always used it. With the two
 * taken from different places they disagreed: a letter headed "A word from the Managing
 * Director" signed "Founding Partner".
 *
 * The fallback is for a firm that clears the field. A stored blank overrides the
 * default, and "A word from the" is worse than a title nobody chose.
 */
function roleOf(mdTitle: string): string {
  return mdTitle.trim() || "Managing Director";
}

/** Initials for the signature block, where there is no photograph to use. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function WelcomeCard({
  body,
  firmName,
  mdName,
  mdTitle,
  variant = "letter",
}: WelcomeCardProps) {
  if (!body.trim()) return null;

  switch (variant) {
    case "masthead":
      return <Masthead {...{ body, firmName, mdName, mdTitle }} />;
    case "quiet":
      return <Quiet {...{ body, firmName, mdName, mdTitle }} />;
    case "portrait":
      return <Portrait {...{ body, firmName, mdName, mdTitle }} />;
    default:
      return <Letter {...{ body, firmName, mdName, mdTitle }} />;
  }
}

type Inner = Omit<WelcomeCardProps, "variant">;

/**
 * 1. Letter.
 *
 * The card as a piece of correspondence: a narrower measure than the rest of the page,
 * a rule under the salutation, and the signature set the way a letter signs off. The
 * point is the reading width - prose at 75 characters is read, prose at 120 is skimmed,
 * and this is the one thing on the screen meant to be read.
 */
function Letter({ body, firmName, mdName, mdTitle }: Inner) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-6 py-3 dark:bg-slate-800/40">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          A word from the {roleOf(mdTitle)}
        </p>
      </div>
      <div className="px-6 py-7">
        <div className="mx-auto max-w-[65ch] prose-welcome">
          <Markdown>{body}</Markdown>
        </div>
        <div className="mx-auto mt-7 max-w-[65ch] border-t border-slate-200 pt-5">
          <p className="font-serif text-2xl italic text-slate-700 dark:text-slate-200">
            {mdName}
          </p>
          <p className="mt-0.5 text-sm text-slate-500">
            {mdTitle}, {firmName}
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * 2. Masthead.
 *
 * A deep brand band across the top carrying the greeting, with the letter beneath it on
 * the panel. It is the only card on the page with a coloured header, so the eye lands
 * here first - which on somebody's first morning is where it should land.
 */
function Masthead({ body, firmName, mdName, mdTitle }: Inner) {
  return (
    <section className="card overflow-hidden">
      <div className="bg-brand-700 px-6 py-7 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
          {firmName}
        </p>
        <h2 className="mt-1.5 font-serif text-3xl">Welcome</h2>
      </div>
      <div className="px-6 py-6">
        <div className="max-w-[68ch] prose-welcome">
          <Markdown>{body}</Markdown>
        </div>
        <div className="mt-6 flex items-center gap-3 border-t border-slate-200 pt-4">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white">
            {initials(mdName)}
          </span>
          <span>
            <span className="block font-semibold text-slate-800 dark:text-slate-100">
              {mdName}
            </span>
            <span className="block text-sm text-slate-500">{mdTitle}</span>
          </span>
        </div>
      </div>
    </section>
  );
}

/**
 * 3. Quiet.
 *
 * No card at all. The welcome sits directly on the page above the panels, with a single
 * accent rule down its left edge, so it reads as the page speaking rather than as one
 * more box among the boxes. The most restrained of the four, and the one that survives a
 * long message best.
 */
function Quiet({ body, firmName, mdName, mdTitle }: Inner) {
  return (
    <section className="border-l-[3px] border-brand-500 py-1 pl-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
        Welcome to {firmName}
      </p>
      <div className="mt-4 max-w-[68ch] prose-welcome">
        <Markdown>{body}</Markdown>
      </div>
      <p className="mt-5 text-sm">
        <span className="font-semibold text-slate-800 dark:text-slate-100">{mdName}</span>
        <span className="text-slate-500"> · {mdTitle}</span>
      </p>
    </section>
  );
}

/**
 * 4. Portrait.
 *
 * A two-column card: the signature block held in a tinted rail on the left, the message
 * beside it. The name is beside the message rather than after it, so it is a person
 * speaking from the first line rather than an anonymous notice that turns out at the end
 * to have been signed.
 */
function Portrait({ body, firmName, mdName, mdTitle }: Inner) {
  return (
    <section className="card overflow-hidden">
      <div className="grid gap-0 md:grid-cols-[15rem_1fr]">
        <div className="flex flex-col justify-center gap-3 bg-brand-50 px-6 py-7 dark:bg-brand-900/25">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-brand-600 text-lg font-semibold text-white">
            {initials(mdName)}
          </span>
          <span>
            <span className="block font-semibold text-slate-900 dark:text-slate-100">
              {mdName}
            </span>
            <span className="block text-sm text-slate-600 dark:text-slate-300">
              {mdTitle}
            </span>
            <span className="mt-1 block text-xs text-slate-500">{firmName}</span>
          </span>
        </div>
        <div className="px-6 py-7">
          <h2 className="mb-3 font-serif text-2xl text-slate-900 dark:text-slate-100">
            Welcome
          </h2>
          <div className="max-w-[64ch] prose-welcome">
            <Markdown>{body}</Markdown>
          </div>
        </div>
      </div>
    </section>
  );
}
