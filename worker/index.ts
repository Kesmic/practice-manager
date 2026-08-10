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
import { registerClientRoutes } from "./routes/clients";
import { registerDocumentRoutes } from "./routes/documents";
import { registerEmployeeRoutes } from "./routes/employees";
import { registerEngagementRoutes } from "./routes/engagements";
import { registerInsightRoutes } from "./routes/insights";
import { registerReviewRoutes } from "./routes/reviews";
import { registerSettingsRoutes } from "./routes/settings";
import { registerTaskItemRoutes } from "./routes/task-items";
import { registerTaskRoutes } from "./routes/tasks";
import { registerTemplateRoutes } from "./routes/templates";
import { registerUserRoutes } from "./routes/users";
import { registerWorkflowRoutes } from "./routes/workflow";

const router = new Router<Env>();

registerAuthRoutes(router);
registerUserRoutes(router);
registerClientRoutes(router);
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

// Employee portal: HR records, onboarding and portal documents.
registerEmployeeRoutes(router);
registerDocumentRoutes(router);
registerSettingsRoutes(router);

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
async function serveApp(request: Request, env: Env): Promise<Response> {
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return asset;

  // Only navigations get the shell. A POST or PUT to a path that does not exist
  // is a genuine 404, and answering it with an HTML page would hide the mistake.
  if (request.method !== "GET" && request.method !== "HEAD") return asset;

  const shell = await env.ASSETS.fetch(
    new Request(new URL("/index.html", request.url), { headers: request.headers }),
  );
  if (!shell.ok) return asset;

  return new Response(shell.body, {
    status: 200,
    headers: shell.headers,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return serveApp(request, env);
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
