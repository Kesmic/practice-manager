/**
 * Markdown on screen, rendered from the shared grammar.
 *
 * Deliberately not `dangerouslySetInnerHTML`: policy and contract text is authored in
 * the portal, so rendering it as raw HTML would turn the document editor into a
 * cross-site scripting vector for anyone with HR access. Emitting React elements means
 * the text can never become markup.
 *
 * The parsing lives in `shared/markdown.ts` rather than here because a downloaded signed
 * copy has to render the same document the same way. A second parser written for the
 * download could disagree about a numbered list or a bold run, and the person would have
 * signed one thing and be holding another. One grammar, two thin renderers.
 */

import type { ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@shared/markdown";

interface Props {
  children: string;
  className?: string;
}

export function Markdown({ children, className }: Props) {
  return (
    <div
      className={`space-y-3 text-sm leading-relaxed text-slate-700 ${className ?? ""}`}
    >
      {parseMarkdown(children).map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}

/** Headings shift down one, as in the HTML renderer: the page's own title is the h1. */
const HEADING_STYLES: Record<number, string> = {
  1: "text-xl font-semibold text-slate-900 mt-2",
  2: "text-base font-semibold text-slate-900 mt-4",
  3: "text-sm font-semibold text-slate-900 mt-3",
  4: "text-sm font-semibold text-slate-700 mt-2",
  5: "text-sm font-semibold text-slate-700",
  6: "text-xs font-semibold uppercase tracking-wide text-slate-600",
};

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "rule":
      return <hr className="my-4 border-slate-200" />;

    case "heading": {
      const Tag = (`h${Math.min(block.level + 1, 6)}` as unknown) as "h2";
      return (
        <Tag className={HEADING_STYLES[block.level] ?? HEADING_STYLES[3]}>
          <InlineView nodes={block.content} />
        </Tag>
      );
    }

    case "quote":
      return (
        <blockquote className="border-l-2 border-slate-300 pl-3 text-slate-600">
          <InlineView nodes={block.content} />
        </blockquote>
      );

    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          className={`ml-5 space-y-1.5 ${block.ordered ? "list-decimal" : "list-disc"}`}
        >
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineView nodes={item} />
            </li>
          ))}
        </Tag>
      );
    }

    default:
      return (
        <p>
          <InlineView nodes={block.content} />
        </p>
      );
  }
}

function InlineView({ nodes }: { nodes: Inline[] }): ReactNode {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.kind) {
          case "strong":
            return (
              <strong key={i} className="font-semibold text-slate-900">
                {node.text}
              </strong>
            );
          case "em":
            return (
              <em key={i} className="italic">
                {node.text}
              </em>
            );
          case "code":
            return (
              <code key={i} className="rounded bg-slate-100 px-1 py-0.5 text-xs">
                {node.text}
              </code>
            );
          case "link":
            return (
              <a
                key={i}
                href={node.href}
                target="_blank"
                rel="noreferrer noopener"
                className="link"
              >
                {node.text}
              </a>
            );
          default:
            return <span key={i}>{node.text}</span>;
        }
      })}
    </>
  );
}
