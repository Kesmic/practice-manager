/**
 * Kesmic Practice Manager — Cloudflare Worker entry point.
 *
 * Serves the JSON API under /api/* and hands everything else to the static
 * asset binding, which holds the built React app. Because the app and the API
 * share one origin there is no CORS layer and session cookies stay SameSite.
 */

import type { Env } from "./env";
import { Router, errorResponse, json } from "./http";
import { registerAuthRoutes } from "./routes/auth";
import { registerClientRoutes } from "./routes/clients";
import { registerEngagementRoutes } from "./routes/engagements";
import { registerInsightRoutes } from "./routes/insights";
import { registerReviewRoutes } from "./routes/reviews";
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      // Static assets and the SPA fallback are handled by the assets binding.
      return env.ASSETS.fetch(request);
    }

    try {
      const match = router.match(request.method, url.pathname);
      if (!match) {
        return json({ error: `No API endpoint at ${url.pathname}` }, 404);
      }
      return await match.handler({ request, env, params: match.params, url });
    } catch (err) {
      return errorResponse(err);
    }
  },
} satisfies ExportedHandler<Env>;
