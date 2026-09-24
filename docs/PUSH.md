# Push notifications

The portal can be installed as an app - on a phone's home screen, or from the
browser's address bar on a laptop - and, once installed or simply open, can tell a
member of staff about their inbox even when the portal is closed. Each person turns it
on for each device from **Your account → Notifications**.

## Setting it up, once

Push needs a signing key pair (VAPID) so that the browsers' push services know the
messages come from this portal. Generate one:

    node scripts/vapid-keys.mjs

Put the public key in `wrangler.toml` under `[vars]`:

    VAPID_PUBLIC_KEY = "BPxk…"
    VAPID_SUBJECT = "mailto:portal@kesmic.org"

and the private key in as a secret:

    npx wrangler pages secret put VAPID_PRIVATE_KEY --project-name kesmic-practice-manager

For local work, both go in `.dev.vars`. Without the keys the portal sends no pushes and
the account page says so.

Never rotate the keys casually: every enrolled device is tied to the public key, and a
new pair means everybody enrols again.

## What is pushed

Everything that lands in a member of staff's portal inbox - a deliverable assigned, a
client offered, a review point raised, a training course to take. The Worker looks
for unpushed inbox rows after every request that could have written one, and sends
each once. Tapping the notification opens the thing it is about.

Clients and growth partners can install the portal as an app too, but nothing is
pushed to them: their portals have no inbox to push from.

## Installing on a phone

- **Android (Chrome):** the browser offers "Add to home screen"; or ⋮ → *Install app*.
- **iPhone (Safari):** Share → *Add to Home Screen*. On iOS, push only works from the
  installed app, and only on iOS 16.4 or later.
- **Laptop (Chrome, Edge):** the install icon at the right of the address bar.
