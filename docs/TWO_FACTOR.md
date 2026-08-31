# Two-step sign-in

A six-digit code from an authenticator app, as well as a password.

## Why an app, and not email or a text message

The portal's email comes from the same domain the firm's mailboxes are on. Emailing
someone their second factor means that whoever can read a partner's mail has both
factors, and the second one has stopped being a second factor. A text message has the
same problem through the phone company, and adds a per-message cost for no gain.

An authenticator app holds a secret that never travels after enrolment, costs nothing per
sign-in, and works when the network does not.

## What it is, technically

TOTP, RFC 6238: HMAC-SHA1 over a 30-second counter, truncated to six digits, with a
160-bit shared secret. This is what every authenticator app implements, and several
implement nothing else.

SHA-1 here is not an oversight. The security of a TOTP does not rest on SHA-1's
collision resistance; it rests on HMAC with a secret key, where SHA-1 is still sound,
and on the code lasting thirty seconds.

The implementation is checked against all six published RFC 6238 vectors, and the
end-to-end suite generates its codes with a separate implementation written from the RFC,
so the two would have to be wrong in the same way to pass.

### Numbers

| Thing | Value | Why |
| --- | --- | --- |
| Digits | 6 | What every app displays |
| Period | 30 seconds | The universal default |
| Accepted drift | one period either side | Phone clocks drift, and a code typed as it rolls over must not be refused |
| Secret | 160 bits, base32 | RFC 4226's recommendation |
| Recovery codes | 10, single use | The lost phone is the likely failure, not the attacker |
| Attempts per sign-in | 5 | One in a million per guess; five is not a chance, unbounded would be |
| Half-finished sign-in expires | 5 minutes | Long enough to find your phone |

### A code cannot be used twice

The time step a code came from is recorded against the enrolment, and anything at or
below it is refused afterwards. RFC 6238 requires this, and without it a code read over
a shoulder or out of a log stays usable for the rest of its ninety-second window.

The visible effect: signing in on a second device inside the same thirty seconds asks
you to wait for the next code. That is the trade being made, and the message says so.

## The secret at rest

A TOTP secret is a bearer credential: whoever holds it can produce codes for ever. So it
is encrypted in the database with AES-GCM, under a key derived from `PASSWORD_PEPPER` by
HKDF with its own label, which keeps it cryptographically separate from password hashing.

`PASSWORD_PEPPER` rather than a new secret, deliberately: one more Cloudflare secret that
silently breaks every enrolment when it is missing would cost this firm more than the
risk it removes.

**With no pepper set, secrets are stored as they are**, marked `plain:` so both forms can
be read. That is a defensible position for a small firm, and it is not silent: the account
screen says so, because a database export would then carry every second factor.

**Changing `PASSWORD_PEPPER` after anyone has enrolled breaks their enrolment**, exactly
as it breaks their password. The portal says so plainly rather than reporting a wrong
code, and a Partner resets them.

## The policy

**Portal settings → Sign-in security.** Pick the lowest grade obliged to use it.

The recommendation is **Partner and above**: those grades can reach every client file and
every pay record.

**A new deployment requires it of nobody.** This matters more than it sounds. Had the
default applied to an unconfigured deployment, the migration that added these tables
would have confined every partner and administrator at the firm the instant it deployed,
with no warning and no chance to enrol first: an outage caused by a security feature
switching itself on. Requiring a second factor is the firm's decision, and the screen
recommends it in words instead.

## Enforcement is confinement, not lockout

Somebody required to use it who has not set it up can still sign in. They then reach two
things: their own account screen, and sign out. Everything else answers 403 with the
reason.

Locking them out instead would mean the day the policy changes is the day nobody can
work, and the person who could change it back is locked out too.

## Recovery

Ten single-use codes at enrolment, shown once, stored as SHA-256 salted with the user id.
Nobody can produce them again, including whoever runs the firm.

If the phone and the codes are both gone, a Partner resets the enrolment under
**Sign-in security**. Two rules about that:

- **A Partner cannot reset their own.** One who could would have a way past their own
  second factor needing nothing but their password, which is the thing this exists to
  stop. Use a recovery code, or ask another Partner.
- **Satisfy yourself the person asking is really them.** A phone call you placed to a
  number you already had is the usual test. A request by email is not, because email is
  exactly what an attacker would have.

### If there is only one administrator and they are locked out

The reset requires another Partner, so a firm with exactly one has no in-app way back.
The break-glass is the database:

```
wrangler d1 execute kesmic-practice --remote \
  --command "DELETE FROM user_totp WHERE user_id = (SELECT id FROM users WHERE email = 'you@kesmic.org')"
```

That needs Cloudflare account access, which is the right bar for it. **The better answer
is not to be in that position:** appoint a second Partner before turning the policy on.

## What the two steps actually are

1. `POST /api/auth/login` with email and password. If the account has a confirmed second
   factor, **no session is created and no cookie is sent**. What comes back is a
   challenge: a random 32-byte token, stored only as its SHA-256, valid five minutes,
   five attempts, and worth nothing on its own. It authorises offering a code for one
   account and nothing else.
2. `POST /api/auth/2fa` with the challenge and either a code or a recovery code. Only
   this creates the session.

A stolen password reaches step two and stops.

## The QR code

Generated in the Worker, byte mode, versions 1 to 10, error correction L, as inline SVG.
Written out rather than taken from a library because the pages are served under a strict
content policy with no CDN.

Checked against an independent implementation for every version, both error correction
levels and all eight masks: 80 grids, byte for byte. The chosen mask is the
lowest-scoring one by that implementation's own penalty rules. Sixteen generated codes
were then rendered to images and read back by OpenCV's detector, which is the same job a
phone camera does.

The key is always shown as text as well, in groups of four, because a camera that will
not focus should not stop somebody enrolling.

---

# Signing out after inactivity

Lives on the same screen, because it answers the same question: how much sits between an
unattended desk and the firm's client files.

**Ten minutes by default, and the firm can change or disable it.** Unlike the two-factor
policy, this one ships on. The difference is what each does when it is unwelcome: a second
factor imposed by surprise confines people to one screen with no way out from inside the
portal, while an idle timeout imposed by surprise signs somebody out, which is the
behaviour being asked for and is undone by one click.

## Two halves, both needed

**The server decides.** Every session records when it was last used, and a request
arriving after the window has passed is refused and the session destroyed. This is what
makes the setting real: it holds for a tab closed without signing out, and for a cookie
copied off a machine, neither of which will ever run the page's own timer.

The recorded time is rewritten only when it has gone more than twenty seconds stale, so
continuous work is not a database write per request. The cost is being signed out up to
twenty seconds early at the exact boundary, which on a ten-minute window is three per
cent, and which the browser's own timer normally reaches first and reaches exactly.

**The browser warns.** The server can only notice idleness when the next request arrives,
which for an unattended screen is never. So the page watches for real interaction
(pointer, key, wheel, touch, scroll), warns before the deadline, and signs out when it
passes.

The warning is ninety seconds, capped to a third of the window so that a short setting
does not leave the dialog permanently on screen with its own button unable to dismiss it.

### The two halves measure different things, and have to be reconciled

This component watches for a hand on the machine; the Worker can only see requests.
Reading counts as activity to the first and not to the second, so somebody scrolling
through a long file for ten minutes would keep resetting the page's timer, see no warning
at all, and then be signed out the instant they finally clicked something: present the
whole time, warned about none of it.

So real interaction, and only real interaction, tells the Worker it is still there, at
most twice a window. A session nobody is touching sends nothing at all, which is the part
that keeps the server side honest: every authenticated request is still a genuine action
by a person, so a quiet session really is a quiet person.

## Why it warns rather than simply acting

Somebody reading a long policy without touching anything loses their place; somebody
part-way through a review point loses the review point. A countdown with a button costs
one click and avoids both, and it is the difference between a security control the firm
keeps and one they ask to have turned off.

## The reason is carried through

An idle sign-out returns 401 with `idle_timeout` as its detail, and `/api/auth/me` reports
`idled: true` once. The sign-in screen uses it to say what happened. Without it, somebody
who steps away for lunch comes back to a sign-in screen and no explanation for where their
afternoon went.

## The deploy itself does not sign everybody out

`last_seen_at` has been on the sessions table since the first migration, but nothing ever
wrote to it after the row was created. On a live session it therefore holds the moment
somebody signed in, which for anybody signed in for a few days sits well outside any idle
window the firm would pick. Left alone, the deploy that turns this on would sign out every
person at the firm the instant it landed.

`0010_session_last_seen.sql` starts everyone's clock at the deploy instead. It is the same
shape of problem as a policy that switches itself on during a migration, and it is avoided
the same way. Nothing to run by hand: the deploy workflow applies migrations to the live
database on every push to `main`, before it deploys the app.

## What it does not change

The week-long session expiry is unaffected and still applies with the timeout off. Signing
out still works. Nothing about it touches passwords or second factors.

---

# Two ways to make the second step less of a daily tax

Both exist because a second factor that is merely correct gets switched off. They are not
equally priced, and the difference is the whole of what follows.

## Remembering a device

**Thirty days by default, up to ninety, or off.** After somebody signs in with a code they
can tick a box, and that browser is not asked again until the period runs out.

This costs almost nothing, because the factor was still presented. What is kept afterwards
is a random 32-byte token, stored as its SHA-256 and bound to one account with an expiry.
Somebody who steals it gets what they would have got by stealing a live session cookie,
which is a risk the session cookie already carries and which the inactivity timeout already
bounds.

**Each person sees their own list** on their account screen, with which one they are using
now, and can drop one or all of them. That list is the revocation, and it is why the label
says "Chrome on Windows" rather than a hundred characters of version string: a list nobody
can read is a list nobody prunes.

### Three places it is deliberately stopped from spreading

**Answering the secret questions cannot mint one.** One lucky guess would otherwise buy a
month with no second step at all. A code or a recovery code both mean something physical
was present; those may be remembered.

**Resetting somebody's two-step sign-in forgets their devices.** Without this a reset would
leave the machine already past the second step still past it, for up to a month, and the
usual reason to reset is that a machine is in the wrong hands.

**Switching the setting off forgets what is already remembered.** Somebody turns it off
because they want the second step back now, not in a month.

## Secret questions

**Off until a Partner turns them on**, which is the opposite of every other default here
and is the point.

**This is the weaker route, and the gap is not small.** A code needs the phone in your
hand. An answer needs a fact, and facts about the people at a firm named on its own website
are often reachable by a stranger with a search engine and nearly always by a colleague.
Worse, a fact cannot be taken back: a stolen phone is replaced in an afternoon, while the
town you were born in is compromised for good.

It is offered because the firm asked for it and the risk is theirs to take. What makes it
defensible rather than ornamental:

- **You write your own questions.** A stock list is a list every attacker also has, and
  every leaked stock list too. The suggestions on the screen are prompts to edit, and none
  of them asks for something that appears on a passport or an application form.
- **Answers do not have to be true**, and the screen says so. An answer nobody could guess
  beats an honest one, and you are the only person who ever has to reproduce it.
- **Both answers must be right**, and a failure does not say which one was wrong. Saying so
  would turn one guess at two questions into two independent guesses at one.
- **Nothing stores an answer.** What is kept is a SHA-256 of the folded answer salted with
  the user id, exactly as recovery codes are handled. No endpoint returns one, and nobody
  can read them back, including whoever runs the firm.
- **The five-attempt limit applies** exactly as it does to a code.
- **Two identical questions, or two answers that fold together, are refused.** Two the same
  is one secret wearing two hats, which looks like two factors and is one.

### Folding an answer

Case, outer space, runs of inner space and accents are all folded away before comparison,
because an answer refused for a capital letter is indistinguishable, to the person typing
it, from an answer they have forgotten, and the cost of that confusion is a locked-out
partner. Punctuation is kept: the accent and case rules already cover the mistakes people
actually make.

### Turning it off does not delete anything

Stored questions become unusable rather than destroyed, so a firm that switches this off to
think about it has not silently wiped everybody's setup. Both the sign-in path and the
editing path check the policy, so it is enforced and not merely hidden. Each person can
delete their own.
