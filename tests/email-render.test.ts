/**
 * What somebody actually receives.
 *
 * The renderer produces two bodies - plain text and HTML - and both go in every
 * message. So the thing worth testing is not that one of them is right but that they
 * agree: a button in the HTML with no matching line in the text is a message that says
 * different things depending on which half the reader's mail client shows.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { render } from "../worker/email";

const recipient = { id: "u1", email: "ama@example.test", full_name: "Ama Mensah" };

const message = (over: Record<string, unknown> = {}) => ({
  subject: "Your Kesmic Consulting email address",
  headline: "Your work email address has been set up on Microsoft 365.",
  detail: "Email address: ama.mensah@kesmic.org\nTemporary password: Kx7-vale",
  link: "",
  linkLabel: "",
  firmName: "Kesmic Consulting",
  reason: "a work email address has been created for you",
  ...over,
});

// ---------------------------------------------------------------------------
// A message with nowhere to send anybody
// ---------------------------------------------------------------------------

test("no link means no button, in either half", () => {
  const { text, html } = render(message(), recipient);
  // The empty href is the failure this guards: it looks exactly like a button.
  assert.ok(!html.includes('href=""'), "an empty button was rendered");
  assert.ok(!/<a\s/i.test(html), "a link was rendered with nothing to link to");
  assert.ok(!text.includes(": \n"), "a dangling label was left in the text");
});

test("the details still arrive when there is no button", () => {
  const { text, html } = render(message(), recipient);
  for (const body of [text, html]) {
    assert.ok(body.includes("ama.mensah@kesmic.org"), "the address is missing");
    assert.ok(body.includes("Kx7-vale"), "the password is missing");
  }
});

test("the message still greets and still explains itself", () => {
  // Removing the button must not take the footer or the salutation with it.
  const { text, html } = render(message(), recipient);
  for (const body of [text, html]) {
    assert.ok(body.includes("Ama"), "no greeting");
    assert.ok(
      body.includes("a work email address has been created for you"),
      "no reason given",
    );
  }
});

// ---------------------------------------------------------------------------
// A message that does have somewhere to go
// ---------------------------------------------------------------------------

test("a link is rendered in both halves, not just the pretty one", () => {
  const { text, html } = render(
    message({ link: "https://portal.kesmic.org/login", linkLabel: "Sign in to the portal" }),
    recipient,
  );
  assert.ok(html.includes('href="https://portal.kesmic.org/login"'));
  assert.ok(html.includes("Sign in to the portal"));
  assert.ok(text.includes("Sign in to the portal: https://portal.kesmic.org/login"));
});

test("the two halves carry the same headline", () => {
  const m = message({ link: "https://x.test", linkLabel: "Go" });
  const { text, html } = render(m, recipient);
  assert.ok(text.includes(m.headline));
  assert.ok(html.includes(m.headline));
});
