/**
 * What a client actually reads in an invoice email. The firm gave the wording; these
 * pin it, in both halves, so a later edit to the template cannot quietly change a
 * letter the finance team signs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { base64Utf8, letterDate, mailToken, renderInvoiceEmail } from "../worker/invoice-email";

const FACTS = {
  name: "Kofi Adom",
  number: "CPL202608",
  firmName: "Kesmic Consultancy Hub",
  amountDue: "GHS 1,494.00",
  dueOn: "15 October 2026",
  link: "https://portal.example/api/invoice-mail/abc/view",
  pixel: "https://portal.example/api/invoice-mail/abc/open.gif",
};

test("the invoice email reads the way the firm wrote it", () => {
  const { subject, text, html } = renderInvoiceEmail("issued", FACTS);
  assert.equal(subject, "Invoice CPL202608 from Kesmic Consultancy Hub");
  for (const half of [text, html]) {
    assert.match(half, /Dear Kofi Adom,/);
    assert.match(half, /Thank you for choosing to do business with us\./);
    assert.match(half, /Please find your invoice details/);
    assert.match(half, /We kindly request you to make the payment by the due date\./);
    assert.match(half, /If you have any questions or need further information, please do not hesitate to contact us\./);
    assert.match(half, /Best regards,/);
    assert.match(half, /Finance Team/);
    assert.match(half, /Kesmic Consultancy Hub/);
    assert.match(half, /GHS 1,494\.00/);
    assert.match(half, /15 October 2026/);
  }
  // "here" is the tracked link; the image is the open marker.
  assert.match(html, /<a href="https:\/\/portal\.example\/api\/invoice-mail\/abc\/view"[^>]*>here<\/a>/);
  assert.match(html, /<img src="https:\/\/portal\.example\/api\/invoice-mail\/abc\/open\.gif"/);
  assert.match(text, /here \(https:\/\/portal\.example\/api\/invoice-mail\/abc\/view\)/);
});

test("the notice on the due date says it is due today, and that the invoice is attached", () => {
  const { subject, text, html } = renderInvoiceEmail("due_today", FACTS);
  assert.equal(subject, "Payment reminder: invoice CPL202608 is due today");
  for (const half of [text, html]) {
    assert.match(half, /Please note that payment for invoice CPL202608 is due today\./);
    assert.match(half, /We have attached a copy of the invoice to this email for your convenience\. Please let us know if you have any questions\./);
    assert.match(half, /Finance Team/);
  }
});

test("a late reminder names the date it fell due rather than claiming it is due today", () => {
  const { subject, text } = renderInvoiceEmail("overdue", FACTS);
  assert.equal(subject, "Payment reminder: invoice CPL202608 is overdue");
  assert.match(text, /was due on 15 October 2026 and remains outstanding/);
  assert.doesNotMatch(text, /due today/);
});

test("sending it again uses the same words as the first time", () => {
  assert.equal(renderInvoiceEmail("resent", FACTS).text, renderInvoiceEmail("issued", FACTS).text);
});

test("a name nobody recorded reads Sir/Madam, and a name is escaped in the HTML", () => {
  assert.match(renderInvoiceEmail("issued", { ...FACTS, name: "  " }).text, /Dear Sir\/Madam,/);
  const { html } = renderInvoiceEmail("issued", { ...FACTS, name: "<b>Ama</b>" });
  assert.match(html, /Dear &lt;b&gt;Ama&lt;\/b&gt;,/);
});

test("with no portal address there is no dead link and no image", () => {
  const { html, text } = renderInvoiceEmail("issued", { ...FACTS, link: "", pixel: "" });
  assert.doesNotMatch(html, /<a href/);
  assert.doesNotMatch(html, /<img/);
  assert.match(text, /Please find your invoice details here\./);
});

test("dates read as a letter writes them, tokens are long and unguessable, and attachments survive UTF-8", () => {
  assert.equal(letterDate("2026-10-15"), "15 October 2026");
  const a = mailToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, mailToken());
  const encoded = base64Utf8("GH₵ 1,000 – café");
  assert.equal(new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))), "GH₵ 1,000 – café");
});

// ---------------------------------------------------------------- edited wording

import {
  STANDARD_INVOICE_EMAILS,
  composeInvoiceEmail,
  unknownPlaceholders,
  wordingFor,
  looksLikeEmail,
} from "../shared/invoice-email-wording";

test("edited wording fills in each bracketed word for the person it goes to", () => {
  const { subject, text } = composeInvoiceEmail(
    {
      subject: "[Firm name]: invoice [Invoice number]",
      message: "Hi [First name],\n\n[Amount due] is due on [Due date]. See it [here].\n\nThanks",
    },
    FACTS,
  );
  assert.equal(subject, "Kesmic Consultancy Hub: invoice CPL202608");
  assert.equal(
    text,
    "Hi Kofi,\n\nGHS 1,494.00 is due on 15 October 2026. See it here (https://portal.example/api/invoice-mail/abc/view).\n\nThanks",
  );
});

test("placeholders are read whatever their case, and unknown ones are left as typed and pointed out", () => {
  const { text } = composeInvoiceEmail({ subject: "x", message: "Dear [NAME], re [Contact name]." }, FACTS);
  assert.equal(text, "Dear Kofi Adom, re [Contact name].");
  assert.deepEqual(unknownPlaceholders("Dear [Name], [Contact name] and [here] [Total]"), [
    "[Contact name]",
    "[Total]",
  ]);
});

test("what the Partner types is text, never markup", () => {
  const { html } = composeInvoiceEmail(
    { subject: "x", message: '<script>alert(1)</script> <a href="https://evil.example">pay here</a>' },
    FACTS,
  );
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<a href="https:\/\/evil/);
  assert.match(html, /&lt;script&gt;/);
});

test("a subject is one line, and a line break inside a paragraph is kept", () => {
  const { subject, html, text } = composeInvoiceEmail(
    { subject: "Invoice\r\nBcc: someone@else.example", message: "Best regards,\nFinance Team" },
    FACTS,
  );
  assert.equal(subject, "Invoice Bcc: someone@else.example");
  assert.match(html, /Best regards,<br>Finance Team/);
  assert.equal(text, "Best regards,\nFinance Team");
});

test("[Summary] on its own line is the box of figures; inside a sentence it is one line", () => {
  const alone = composeInvoiceEmail({ subject: "x", message: "Hello\n\n[Summary]\n\nBye" }, FACTS);
  assert.match(alone.html, /<table role="presentation"/);
  assert.match(alone.text, /Invoice: CPL202608\nAmount due: GHS 1,494\.00\nDue date: 15 October 2026/);
  const inline = composeInvoiceEmail({ subject: "x", message: "In short: [Summary]" }, FACTS);
  assert.doesNotMatch(inline.html, /<table/);
  assert.match(inline.text, /In short: Invoice: CPL202608 · Amount due: GHS 1,494\.00 · Due date: 15 October 2026/);
});

test("the firm's saved wording replaces the standard for invoices, never for reminders", () => {
  const saved = { subject: "Our invoice [Invoice number]", message: "Dear [Name]" };
  assert.deepEqual(wordingFor("issued", saved), saved);
  assert.deepEqual(wordingFor("resent", saved), saved);
  assert.deepEqual(wordingFor("overdue", saved), STANDARD_INVOICE_EMAILS.overdue);
  assert.deepEqual(wordingFor("issued", { subject: "", message: " " }), STANDARD_INVOICE_EMAILS.issued);
});

test("an address is one plain mailbox", () => {
  assert.ok(looksLikeEmail("kofi@adomfoods.com"));
  for (const bad of ["kofi", "kofi@adom", "Kofi <kofi@adom.com>", "a@b.com, c@d.com", "a@b.com\nBcc: x@y.z"]) {
    assert.ok(!looksLikeEmail(bad), bad);
  }
});
