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

import { PROVIDERS, copyList, render } from "../worker/email";

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

// ---------------------------------------------------------------------------
// Copying somebody in
// ---------------------------------------------------------------------------

/*
 * Reminders copy the person doing the chasing. Three providers build three different
 * payloads for that, so the rule is tested once and each payload is checked for
 * carrying it - a cc that silently vanishes on one provider is a promise the portal
 * made and did not keep.
 */

test("nobody is copied on their own message", () => {
  // Otherwise the recipient gets it twice, and some providers refuse an address
  // that appears in both fields.
  assert.deepEqual(copyList("ama@x.test", ["ama@x.test"]), []);
  assert.deepEqual(copyList("ama@x.test", ["AMA@X.TEST"]), []);
  assert.deepEqual(copyList(" ama@x.test ", ["ama@x.test"]), []);
});

test("duplicates and blanks are dropped", () => {
  assert.deepEqual(
    copyList("ama@x.test", ["md@x.test", "md@x.test", "", "  "]),
    ["md@x.test"],
  );
});

test("a genuine copy survives", () => {
  assert.deepEqual(copyList("ama@x.test", ["md@x.test"]), ["md@x.test"]);
});

test("every provider carries the copy list", () => {
  const env = {
    EMAIL_FROM: "Kesmic <portal@kesmic.org>",
    EMAIL_API_KEY: "k",
  } as never;
  const cc = ["md@kesmic.org"];

  const resend = PROVIDERS.resend(env, "ama@x.test", "s", "t", "<p>h</p>", cc);
  assert.deepEqual((resend.body as { cc?: string[] }).cc, cc);

  const postmark = PROVIDERS.postmark(env, "ama@x.test", "s", "t", "<p>h</p>", cc);
  assert.equal((postmark.body as { Cc?: string }).Cc, "md@kesmic.org");

  const sendgrid = PROVIDERS.sendgrid(env, "ama@x.test", "s", "t", "<p>h</p>", cc);
  const personalisation = (
    sendgrid.body as { personalizations: Array<{ cc?: Array<{ email: string }> }> }
  ).personalizations[0];
  assert.deepEqual(personalisation.cc, [{ email: "md@kesmic.org" }]);
});

test("no copy list means the field is absent, not empty", () => {
  // An empty cc array is not the same as no cc, and some providers reject one.
  const env = { EMAIL_FROM: "Kesmic <portal@kesmic.org>", EMAIL_API_KEY: "k" } as never;
  assert.ok(!("cc" in (PROVIDERS.resend(env, "a@x.test", "s", "t", "h", []).body as object)));
  assert.ok(!("Cc" in (PROVIDERS.postmark(env, "a@x.test", "s", "t", "h", []).body as object)));
  const sg = PROVIDERS.sendgrid(env, "a@x.test", "s", "t", "h", []).body as {
    personalizations: Array<Record<string, unknown>>;
  };
  assert.ok(!("cc" in sg.personalizations[0]));
});

test("an invoice email carries its attachment, replies to finance, and goes out under the firm's name", () => {
  const env = { EMAIL_API_KEY: "k", EMAIL_FROM: "Kesmic Practice Manager <portal@kesmic.test>" } as never;
  const extras = {
    attachments: [{ filename: "cpl202608.pdf", content: "PGgxPg==", contentType: "application/pdf" }],
    replyTo: "finance@kesmic.test",
    fromName: "Kesmic Consultancy Hub Finance",
  };
  const resend = PROVIDERS.resend(env, "kofi@x.test", "s", "t", "h", [], extras).body as Record<string, unknown>;
  assert.equal(resend.from, "Kesmic Consultancy Hub Finance <portal@kesmic.test>");
  assert.equal(resend.reply_to, "finance@kesmic.test");
  assert.deepEqual(resend.attachments, [{ filename: "cpl202608.pdf", content: "PGgxPg==" }]);

  const postmark = PROVIDERS.postmark(env, "kofi@x.test", "s", "t", "h", [], extras).body as Record<string, unknown>;
  assert.equal(postmark.ReplyTo, "finance@kesmic.test");
  assert.deepEqual(postmark.Attachments, [{ Name: "cpl202608.pdf", Content: "PGgxPg==", ContentType: "application/pdf" }]);

  const sendgrid = PROVIDERS.sendgrid(env, "kofi@x.test", "s", "t", "h", [], extras).body as Record<string, unknown>;
  assert.deepEqual(sendgrid.from, { email: "portal@kesmic.test", name: "Kesmic Consultancy Hub Finance" });
  assert.deepEqual(sendgrid.reply_to, { email: "finance@kesmic.test" });
  assert.equal((sendgrid.attachments as Array<{ disposition: string }>)[0].disposition, "attachment");

  // Without extras, nothing about an ordinary notification changes.
  const plain = PROVIDERS.resend(env, "kofi@x.test", "s", "t", "h", []).body as Record<string, unknown>;
  assert.equal(plain.from, "Kesmic Practice Manager <portal@kesmic.test>");
  assert.ok(!("attachments" in plain) && !("reply_to" in plain));
});

test("the provider never rewrites links through its own tracking domain", () => {
  const env = { EMAIL_API_KEY: "k", EMAIL_FROM: "portal@kesmic.test" } as unknown as Parameters<typeof PROVIDERS.sendgrid>[0];
  const sg = PROVIDERS.sendgrid(env, "a@x.test", "s", "t", "h", []).body as {
    tracking_settings: { click_tracking: { enable: boolean; enable_text: boolean }; open_tracking: { enable: boolean } };
  };
  assert.deepEqual(sg.tracking_settings.click_tracking, { enable: false, enable_text: false });
  assert.equal(sg.tracking_settings.open_tracking.enable, false);
  const pm = PROVIDERS.postmark(env, "a@x.test", "s", "t", "h", []).body as { TrackLinks: string; TrackOpens: boolean };
  assert.equal(pm.TrackLinks, "None");
  assert.equal(pm.TrackOpens, false);
});
