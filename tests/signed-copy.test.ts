/**
 * The downloadable signed copy, and the grammar it shares with the screen.
 *
 * The property that matters most is the one in the first group: the document somebody
 * downloads has to be the document they read. Before this, the screen parsed markdown
 * into React elements and nothing else could parse it at all - so a download would have
 * needed a second parser, and two parsers that disagree about a numbered list mean a
 * person signed one thing and is holding another.
 *
 * The second thing pinned here is that the certificate tells the truth when the document
 * has been amended since signature. A signed copy whose text has drifted is worse than
 * no copy at all, because it looks convincing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  escapeHtml,
  parseInline,
  parseMarkdown,
  renderMarkdownHtml,
} from "../shared/markdown";
import {
  formatStamp,
  groupHash,
  renderSignedCopy,
  signedCopyFilename,
  textIsIntact,
  type SignedCopy,
} from "../shared/signed-copy";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const BODY = `## Contract of Employment

**Between** Kesmic Consulting **and** Ama Boateng.

### 1. Position

The Employee is engaged as *Tax Associate*, reporting to Kofi Mensah.

1. First numbered term.
2. Second numbered term.

- A bullet
- Another bullet

> A quoted passage.

---

By signing, the Employee confirms agreement.`;

const copy = (over: Partial<SignedCopy> = {}): SignedCopy => ({
  title: "Contract of Employment - Ama Boateng",
  body: BODY,
  kind: "contract",
  version: 1,
  signatory_name: "Ama Boateng",
  signatory_email: "ama@kesmic.org",
  typed_name: "Ama Boateng",
  action: "signed",
  signed_at: "2026-09-14T09:42:11.000Z",
  ip_address: "41.66.12.9",
  user_agent: "Mozilla/5.0",
  content_hash: sha(BODY),
  current_hash: sha(BODY),
  firm_name: "Kesmic Consulting",
  ...over,
});

// ---------------------------------------------------------------------------
// One grammar, two renderers
// ---------------------------------------------------------------------------

test("the grammar recognises everything the contracts use", () => {
  const blocks = parseMarkdown(BODY);
  const kinds = blocks.map((b) => b.kind);
  assert.ok(kinds.includes("heading"));
  assert.ok(kinds.includes("paragraph"));
  assert.ok(kinds.includes("list"));
  assert.ok(kinds.includes("quote"));
  assert.ok(kinds.includes("rule"));
});

test("a numbered list stays numbered and a bulleted one stays bulleted", () => {
  // The exact thing two separate parsers would be likely to disagree about.
  const lists = parseMarkdown(BODY).filter((b) => b.kind === "list");
  assert.equal(lists.length, 2);
  assert.equal(lists[0].kind === "list" && lists[0].ordered, true);
  assert.equal(lists[1].kind === "list" && lists[1].ordered, false);

  const html = renderMarkdownHtml(BODY);
  assert.ok(html.includes("<ol>"));
  assert.ok(html.includes("<ul>"));
});

test("headings shift down one, so the page's own title is the only h1", () => {
  const html = renderMarkdownHtml("# Top\n\n## Next");
  assert.ok(html.includes("<h2>Top</h2>"));
  assert.ok(html.includes("<h3>Next</h3>"));
  assert.ok(!html.includes("<h1>"));
});

test("bold and italic survive into the HTML", () => {
  const html = renderMarkdownHtml("**bold** and *italic*");
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes("<em>italic</em>"));
});

test("a continuation line folds into the bullet above it", () => {
  const blocks = parseMarkdown("- first line\n  carried on\n- second");
  const list = blocks[0];
  assert.equal(list.kind, "list");
  if (list.kind !== "list") return;
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0][0].text, "first line carried on");
});

// ---------------------------------------------------------------------------
// Nothing in a document may become markup
// ---------------------------------------------------------------------------

test("document text cannot put markup into the downloaded file", () => {
  // Documents are authored inside the portal by people with HR access. A signed copy is
  // a file the firm hands to an employee and the employee hands to a bank.
  const html = renderMarkdownHtml('<script>alert(1)</script> & "quotes"');
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&amp;"));
});

test("only plain http links become links", () => {
  // javascript: and data: render as their label rather than as something clickable.
  const nodes = parseInline("[safe](https://example.test) [bad](javascript:alert(1))");
  assert.equal(nodes.find((n) => n.kind === "link")?.href, "https://example.test");
  assert.ok(!nodes.some((n) => n.kind === "link" && n.href.startsWith("javascript:")));
});

test("a link href is escaped as well as its label", () => {
  const html = renderMarkdownHtml('[x](https://example.test/?a="b")');
  assert.ok(!html.includes('?a="b"'));
  assert.ok(html.includes("&quot;"));
});

test("escapeHtml covers every character that could close a tag or an attribute", () => {
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});

test("a signatory's own name is escaped into the certificate", () => {
  // The typed name has to match their account name, but the account name is set by an
  // administrator and is not a safe string.
  const html = renderSignedCopy(
    copy({ typed_name: '</p><script>x</script>', signatory_name: "A & B" }),
  );
  assert.ok(!html.includes("<script>x</script>"));
  assert.ok(html.includes("A &amp; B"));
});

// ---------------------------------------------------------------------------
// The certificate tells the truth
// ---------------------------------------------------------------------------

test("a copy whose text still matches says so", () => {
  const c = copy();
  assert.equal(textIsIntact(c), true);
  const html = renderSignedCopy(c);
  assert.ok(html.includes("is the text that was signed"));
  assert.ok(!html.includes("Warning:"));
});

test("a copy whose document was amended since says so, loudly", () => {
  // The failure that matters. A signed copy that has drifted from what was signed is
  // worse than none, because it looks convincing.
  const c = copy({ content_hash: sha("something else") });
  assert.equal(textIsIntact(c), false);
  const html = renderSignedCopy(c);
  assert.ok(html.includes("Warning: the text in this file is not the text that was signed"));
  assert.ok(!html.includes("is the text that was signed.</strong> The two fingerprints above are identical"));
});

test("both fingerprints appear, so the reader can compare them", () => {
  const c = copy({ content_hash: sha("something else") });
  const html = renderSignedCopy(c);
  assert.ok(html.includes(groupHash(c.content_hash)));
  assert.ok(html.includes(groupHash(c.current_hash)));
});

test("the certificate carries every piece of evidence the record holds", () => {
  const html = renderSignedCopy(copy());
  for (const expected of [
    "Ama Boateng",
    "ama@kesmic.org",
    "41.66.12.9",
    "Mozilla/5.0",
    "Version 1",
    "14 September 2026 at 09:42 UTC",
    "2026-09-14T09:42:11.000Z",
  ]) {
    assert.ok(html.includes(escapeHtml(expected)), expected);
  }
});

test("an absent IP or device is left out rather than printed as null", () => {
  const html = renderSignedCopy(copy({ ip_address: null, user_agent: null }));
  assert.ok(!html.includes("null"));
  assert.ok(!html.includes("IP address"));
  assert.ok(!html.includes(">Device<"));
});

test("the certificate does not claim more than the portal can support", () => {
  // Whether a typed name is a signature is a legal question, not one a file settles by
  // asserting it.
  const html = renderSignedCopy(copy());
  assert.ok(html.includes("is a matter for the law that applies"));
  assert.ok(!/qualified electronic signature/i.test(html));
  assert.ok(!/legally binding/i.test(html));
});

test("an acknowledgement is described as one, not as a signature", () => {
  const html = renderSignedCopy(copy({ action: "acknowledged" }));
  assert.ok(html.includes("acknowledged by"));
  assert.ok(html.includes(">Acknowledged<"));
});

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

test("the filename says what it is and when, and is safe on any filesystem", () => {
  const name = signedCopyFilename(copy());
  assert.match(name, /^[a-z0-9-]+-2026-09-14\.html$/);
  assert.ok(name.includes("contract-of-employment"));
  assert.ok(name.includes("ama-boateng"));
});

test("a title of nothing but punctuation still produces a usable filename", () => {
  const name = signedCopyFilename(copy({ title: "***", signatory_name: "///" }));
  assert.equal(name, "signed-document-2026-09-14.html");
});

test("the stamp reads as a date rather than a timestamp", () => {
  assert.equal(formatStamp("2026-09-14T09:42:11.000Z"), "14 September 2026 at 09:42 UTC");
  assert.equal(formatStamp("2026-01-01T00:05:00.000Z"), "1 January 2026 at 00:05 UTC");
});

test("an unparseable date is shown as it was stored rather than as Invalid Date", () => {
  assert.equal(formatStamp("not a date"), "not a date");
});

test("the fingerprint is grouped so a person can read it against another", () => {
  const grouped = groupHash("a".repeat(64));
  assert.equal(grouped.split(" ").length, 8);
  assert.equal(grouped.replace(/ /g, ""), "a".repeat(64));
});

test("the file is self-contained: no external stylesheet, script or image", () => {
  // It has to open and print correctly on a machine that has never seen the portal.
  const html = renderSignedCopy(copy());
  assert.ok(!/<link\b/i.test(html));
  assert.ok(!/<script\b/i.test(html));
  assert.ok(!/<img\b/i.test(html));
  assert.ok(html.includes("@media print"));
});
