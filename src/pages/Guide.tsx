/**
 * The user guide, in the portal.
 *
 * Only the sections that apply to the reader are offered: gated by grade, and by what
 * this firm has opened to that grade. A guide that explains screens you cannot reach
 * teaches people to stop reading it.
 */

import { useState } from "react";
import { ROLE_LABELS } from "@shared/workflow";
import { guideFor } from "@shared/guide";
import { useSession } from "../lib/auth";
import { Markdown } from "../components/Markdown";
import { Spinner } from "../components/ui";

export function Guide() {
  const { user, canSee } = useSession();
  const [open, setOpen] = useState<string | null>(null);

  if (!user) return <Spinner label="Loading" />;

  const sections = guideFor(user.role, canSee);
  const current = sections.find((section) => section.id === open) ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="section-title">How to use the portal</h1>
        <p className="muted mt-0.5">
          Written for {ROLE_LABELS[user.role]} grade. {sections.length} section(s) apply
          to you, out of everything the guide covers.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
        {/* Contents. Every section is one click away rather than a scroll away. */}
        <nav className="card p-2">
          <ul className="space-y-0.5">
            {sections.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => setOpen(section.id)}
                  aria-current={current?.id === section.id ? "true" : undefined}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    current?.id === section.id
                      ? "bg-brand-50 font-semibold text-link"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="block">{section.title}</span>
                  <span className="muted mt-0.5 block text-xs">{section.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="card p-5">
          {current ? (
            <>
              <h2 className="card-title mb-3">{current.title}</h2>
              <Markdown>{current.body}</Markdown>
            </>
          ) : (
            /* No section chosen: show the whole thing rather than an empty panel, so
               the guide is readable straight through as well as by section. */
            <div className="space-y-8">
              {sections.map((section) => (
                <section key={section.id} id={section.id}>
                  <h2 className="card-title mb-3">{section.title}</h2>
                  <Markdown>{section.body}</Markdown>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
