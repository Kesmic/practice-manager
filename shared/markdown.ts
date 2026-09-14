/**
 * The portal's markdown grammar, parsed once and rendered two ways.
 *
 * There is one place this matters more than anywhere else: a contract. Somebody reads
 * the document on screen, types their name, and the firm keeps a SHA-256 of the text
 * they agreed to. When they later download a signed copy, that copy has to be the same
 * document - and if the download were produced by a second renderer written separately
 * from the on-screen one, the two could disagree about what a numbered list or a bold
 * run looks like. The person would have signed one thing and be holding another.
 *
 * So the grammar lives here and produces a small tree, and the two renderers are thin:
 * `src/components/Markdown.tsx` turns the tree into React elements for the screen, and
 * `renderMarkdownHtml` below turns the same tree into HTML for a downloaded copy.
 *
 * Deliberately small. It supports what the handbook and the contracts actually use -
 * headings, paragraphs, lists, bold, italic, inline code, links, blockquotes and rules -
 * and nothing else. A fuller parser would be a larger surface for no document anybody
 * has written.
 */

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: number; content: Inline[] }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "quote"; content: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "rule" };

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])\1{2,}\s*$/;
const QUOTE = /^>\s?/;
const BULLET = /^\s*[-*+]\s+/;
const NUMBER = /^\s*\d+\.\s+/;

/** Whether this line starts a block of its own, and so ends the one being read. */
function startsBlock(line: string): boolean {
  return (
    HEADING.test(line) || BULLET.test(line) || NUMBER.test(line) || QUOTE.test(line) ||
    RULE.test(line)
  );
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        content: parseInline(heading[2]),
      });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        quoted.push(lines[index].replace(QUOTE, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", content: parseInline(quoted.join(" ")) });
      continue;
    }

    if (BULLET.test(line) || NUMBER.test(line)) {
      const ordered = !BULLET.test(line);
      const marker = ordered ? NUMBER : BULLET;
      const items: Inline[][] = [];

      while (index < lines.length && marker.test(lines[index])) {
        let text = lines[index].replace(marker, "");
        index += 1;
        // A line that is not itself a new block folds into the bullet above it.
        while (
          index < lines.length &&
          lines[index].trim() &&
          !startsBlock(lines[index])
        ) {
          text += ` ${lines[index].trim()}`;
          index += 1;
        }
        items.push(parseInline(text));
      }

      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", content: parseInline(paragraph.join(" ")) });
  }

  return blocks;
}

/**
 * Inline formatting, tokenised in one pass so that a link label containing an asterisk
 * is not mangled by the emphasis rules.
 */
export function parseInline(text: string): Inline[] {
  const pattern =
    /(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/g;

  const out: Inline[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      out.push({ kind: "text", text: text.slice(cursor, match.index) });
    }
    const token = match[0];

    if (token.startsWith("**") || token.startsWith("__")) {
      out.push({ kind: "strong", text: token.slice(2, -2) });
    } else if (token.startsWith("`")) {
      out.push({ kind: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      /*
       * Only plain http(s) links become links. Anything else - `javascript:`, `data:` -
       * renders as its label, so a document author cannot turn the handbook into a
       * delivery mechanism.
       */
      if (link && /^https?:\/\//i.test(link[2])) {
        out.push({ kind: "link", text: link[1], href: link[2] });
      } else {
        out.push({ kind: "text", text: link ? link[1] : token });
      }
    } else {
      out.push({ kind: "em", text: token.slice(1, -1) });
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) out.push({ kind: "text", text: text.slice(cursor) });
  return out;
}

// ---------------------------------------------------------------------------
// Rendering to HTML
// ---------------------------------------------------------------------------

/**
 * Escapes text for HTML.
 *
 * Everything that reaches the HTML renderer goes through this, including link hrefs.
 * Document text is authored inside the portal by people with HR access, so treating it
 * as trusted would make the document editor a way of putting script into a file the
 * firm then hands to an employee.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineHtml(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      const text = escapeHtml(node.text);
      switch (node.kind) {
        case "strong":
          return `<strong>${text}</strong>`;
        case "em":
          return `<em>${text}</em>`;
        case "code":
          return `<code>${text}</code>`;
        case "link":
          return `<a href="${escapeHtml(node.href)}" rel="noreferrer noopener">${text}</a>`;
        default:
          return text;
      }
    })
    .join("");
}

export function renderMarkdownHtml(source: string): string {
  return parseMarkdown(source)
    .map((block) => {
      switch (block.kind) {
        case "rule":
          return "<hr />";
        case "heading": {
          // Shifted down one, as on screen: the page's own title is the h1.
          const tag = `h${Math.min(block.level + 1, 6)}`;
          return `<${tag}>${inlineHtml(block.content)}</${tag}>`;
        }
        case "quote":
          return `<blockquote>${inlineHtml(block.content)}</blockquote>`;
        case "list": {
          const tag = block.ordered ? "ol" : "ul";
          const items = block.items
            .map((item) => `<li>${inlineHtml(item)}</li>`)
            .join("");
          return `<${tag}>${items}</${tag}>`;
        }
        default:
          return `<p>${inlineHtml(block.content)}</p>`;
      }
    })
    .join("\n");
}
