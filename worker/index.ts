/**
 * Kesmic Practice Manager - Cloudflare Worker entry point.
 *
 * Serves the JSON API under /api/* and hands everything else to the static
 * asset binding, which holds the built React app. Because the app and the API
 * share one origin there is no CORS layer and session cookies stay SameSite.
 *
 * Deployed as a Cloudflare Pages Function in advanced mode: this file is bundled
 * to `dist/_worker.js` and receives every request to the origin, including ones
 * that turn out to be static files.
 */

import type { Env } from "./env";
import { Router, errorResponse, json } from "./http";
import { registerAuthRoutes } from "./routes/auth";
import { registerClientFileRoutes } from "./routes/client-files";
import { registerClientRoutes } from "./routes/clients";
import { registerDocumentRoutes } from "./routes/documents";
import { registerEmployeeRoutes } from "./routes/employees";
import { registerEraseRoutes } from "./routes/erase";
import { registerEngagementRoutes } from "./routes/engagements";
import { registerInsightRoutes } from "./routes/insights";
import { registerIntakeRoutes } from "./routes/intake";
import { registerReviewRoutes } from "./routes/reviews";
import { registerSettingsRoutes } from "./routes/settings";
import { registerTaskItemRoutes } from "./routes/task-items";
import { registerTaskRoutes } from "./routes/tasks";
import { registerTwoFactorRoutes } from "./routes/twofactor";
import { registerTemplateRoutes } from "./routes/templates";
import { registerUserRoutes } from "./routes/users";
import { registerWorkflowRoutes } from "./routes/workflow";

const router = new Router<Env>();

registerAuthRoutes(router);
registerUserRoutes(router);
registerClientRoutes(router);
// The client file: links to documents held in SharePoint, OneDrive or Google Drive.
registerClientFileRoutes(router);
registerEngagementRoutes(router);
registerTaskRoutes(router);
// Workflow, review and item routes are registered after tasks so that the more
// specific /api/tasks/:id/... patterns are declared alongside them; the router
// matches on segment count and literals, so ordering is not significant.
registerWorkflowRoutes(router);
registerReviewRoutes(router);
registerTaskItemRoutes(router);
registerTemplateRoutes(router);
registerInsightRoutes(router);

// Client intake: the two public request links and the queue they feed.
registerIntakeRoutes(router);

// Employee portal: HR records, onboarding and portal documents.
registerEmployeeRoutes(router);
registerDocumentRoutes(router);
registerSettingsRoutes(router);
registerEraseRoutes(router);
registerTwoFactorRoutes(router);

/**
 * The browser-facing security headers.
 *
 * These belong on the app, not on the API. `worker/http.ts` puts a short set on every
 * JSON response, which is close to pointless - a JSON body is not a document, cannot be
 * framed and cannot run a script. What can be framed and can run a script is the HTML
 * and JavaScript served from here, and until now that went out bare.
 *
 * What each one is actually for:
 *
 * - **frame-ancestors / X-Frame-Options.** Without them the portal can be loaded in an
 *   invisible frame on somebody else's page and a colleague tricked into clicking a
 *   button they cannot see. Every destructive action in the portal is one click behind a
 *   session that stays signed in for days, so this is the one that matters most.
 *   `X-Frame-Options` is the same rule again for browsers that predate CSP.
 * - **script-src 'self'.** The built bundle is the only script that may run. It turns any
 *   future injection hole into a broken page rather than a stolen session.
 * - **object-src / base-uri 'none'.** Two old tricks for turning a content hole into
 *   script execution: a plugin object, and rewriting <base> so every relative script URL
 *   resolves somewhere else.
 * - **form-action 'self'.** A form injected into the page cannot post the fields
 *   somebody just typed to another origin.
 * - **connect-src 'self'.** The app talks to its own API and nothing else. There is no
 *   analytics, no font CDN and no error reporter here, and this makes that a rule rather
 *   than a habit.
 *
 * Two deliberate relaxations, both narrow:
 *
 * - **`img-src` allows `data:`.** The firm's logo is stored as a data URL in settings
 *   rather than as a file, and `src/lib/logo.ts` derives the light-ink version in a
 *   canvas, which also produces one.
 * - **`style-src` allows `'unsafe-inline'`.** `src/lib/branding.ts` writes the
 *   administrator's chosen colours into an injected <style> element, and the values are
 *   chosen at runtime so neither a hash nor a fixed nonce can cover them. Inline style is
 *   a far smaller exposure than inline script, and the portal never renders authored
 *   text as HTML - `src/components/Markdown.tsx` emits React elements precisely so that
 *   it cannot.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

function applyAppSecurityHeaders(response: Response, url: URL): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CSP);
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  // The portal uses none of these. Saying so stops an injected iframe or a future
  // dependency reaching for them on a page the firm trusts.
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );
  // Only meaningful over TLS, and `wrangler pages dev` serves plain HTTP on localhost.
  // Sent conditionally so a local run cannot pin a developer's browser to HTTPS for a
  // hostname that has no certificate.
  if (url.protocol === "https:") {
    headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Serves a static file, falling back to the app shell so that client-side routes
 * survive a hard refresh: someone opening /deliverables/abc directly has to be
 * given index.html and let the router take it from there.
 *
 * Written out rather than left to the platform on purpose. Workers with static
 * assets has a `not_found_handling` setting for this; Pages has its own
 * behaviour; doing it here means the two cannot disagree, and the intent is
 * visible in the code that depends on it.
 */
async function serveApp(request: Request, env: Env, url: URL): Promise<Response> {
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return applyAppSecurityHeaders(asset, url);

  // Only navigations get the shell. A POST or PUT to a path that does not exist
  // is a genuine 404, and answering it with an HTML page would hide the mistake.
  if (request.method !== "GET" && request.method !== "HEAD") {
    return applyAppSecurityHeaders(asset, url);
  }

  const shell = await env.ASSETS.fetch(
    new Request(new URL("/index.html", request.url), { headers: request.headers }),
  );
  if (!shell.ok) return applyAppSecurityHeaders(asset, url);

  return applyAppSecurityHeaders(
    new Response(shell.body, {
      status: 200,
      headers: shell.headers,
    }),
    url,
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return serveApp(request, env, url);
    }

    try {
      const match = router.match(request.method, url.pathname);
      if (!match) {
        return json({ error: `No API endpoint at ${url.pathname}` }, 404);
      }
      return await match.handler({
        request,
        env,
        params: match.params,
        url,
        waitUntil: (promise) => ctx.waitUntil(promise),
      });
    } catch (err) {
      return errorResponse(err);
    }
  },
} satisfies ExportedHandler<Env>;
