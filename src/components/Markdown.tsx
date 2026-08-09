/**
 * Minimal markdown renderer producing React elements.
 *
 * Deliberately not `dangerouslySetInnerHTML`: policy and contract text is
 * authored in the portal, so rendering it as raw HTML would turn the document
 * editor into a cross-site scripting vector for anyone with HR access. Emitting
 * React elements means the text can never become markup.
 *
 * Supports the subset the handbook actually needs: headings, paragraphs,
 * unordered and ordered lists, bold, italic, inline code, links, blockquotes and
 * horizontal rules.
 */

import type { ReactNode } from "react";

interface Props {
  children: string;
  className?: string;
}

export function Markdown({ children, className }: Props) {
  return (
    <div
      className={`space-y-3 text-sm leading-relaxed text-slate-700 ${className ?? ""}`}
    >
      {renderBlocks(children)}
    </div>
  );
}

function renderBlocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index];

    // Blank
    if (!line.trim()) {
      index++;
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-4 border-slate-200" />);
      index++;
      continue;
    }

    // Heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const styles: Record<number, string> = {
        1: "text-xl font-semibold text-slate-900 mt-2",
        2: "text-base font-semibold text-slate-900 mt-4",
        3: "text-sm font-semibold text-slate-900 mt-3",
        4: "text-sm font-semibold text-slate-700 mt-2",
        5: "text-sm font-semibold text-slate-700",
        6: "text-xs font-semibold uppercase tracking-wide text-slate-600",
      };
      const Tag = (`h${Math.min(level + 1, 6)}` as unknown) as "h2";
      blocks.push(
        <Tag key={key++} className={styles[level] ?? styles[3]}>
          {renderInline(text)}
        </Tag>,
      );
      index++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^>\s?/, ""));
        index++;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="border-l-2 border-slate-300 pl-3 text-slate-600"
        >
          {renderInline(quoted.join(" "))}
        </blockquote>,
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        let text = lines[index].replace(/^\s*[-*+]\s+/, "");
        index++;
        // Fold continuation lines into the same bullet.
        while (
          index < lines.length &&
          lines[index].trim() &&
          !/^\s*([-*+]|\d+\.)\s+/.test(lines[index]) &&
          !/^#{1,6}\s/.test(lines[index])
        ) {
          text += ` ${lines[index].trim()}`;
          index++;
        }
        items.push(text);
      }
      blocks.push(
        <ul key={key++} className="ml-5 list-disc space-y-1.5">
          {items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        let text = lines[index].replace(/^\s*\d+\.\s+/, "");
        index++;
        while (
          index < lines.length &&
          lines[index].trim() &&
          !/^\s*([-*+]|\d+\.)\s+/.test(lines[index]) &&
          !/^#{1,6}\s/.test(lines[index])
        ) {
          text += ` ${lines[index].trim()}`;
          index++;
        }
        items.push(text);
      }
      blocks.push(
        <ol key={key++} className="ml-5 list-decimal space-y-1.5">
          {items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^#{1,6}\s/.test(lines[index]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index++;
    }
    blocks.push(<p key={key++}>{renderInline(paragraph.join(" "))}</p>);
  }

  return blocks;
}

/**
 * Inline formatting. Tokenised in one pass so that, for example, a link label
 * containing an asterisk is not mangled by the emphasis rules.
 */
function renderInline(text: string): ReactNode[] {
  const pattern =
    /(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/g;

  const out: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) out.push(text.slice(cursor, match.index));
    const token = match[0];

    if (token.startsWith("**") || token.startsWith("__")) {
      out.push(
        <strong key={key++} className="font-semibold text-slate-900">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      out.push(
        <code key={key++} className="rounded bg-slate-100 px-1 py-0.5 text-xs">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link && /^https?:\/\//i.test(link[2])) {
        out.push(
          <a
            key={key++}
            href={link[2]}
            target="_blank"
            rel="noreferrer noopener"
            className="link"
          >
            {link[1]}
          </a>,
        );
      } else {
        // Anything that is not a plain http(s) link renders as text, so
        // `javascript:` and similar schemes cannot become clickable.
        out.push(link ? link[1] : token);
      }
    } else {
      out.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}
