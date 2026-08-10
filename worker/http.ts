/** Small HTTP layer: typed errors, JSON responses and a minimal router. */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, detail?: string) =>
  new HttpError(400, message, detail);
export const unauthorized = (message = "Not signed in.") =>
  new HttpError(401, message);
export const forbidden = (message: string) => new HttpError(403, message);
export const notFound = (message = "Not found.") => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
};

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...SECURITY_HEADERS,
  });
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.append(key, value));
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export function noContent(extraHeaders?: HeadersInit): Response {
  const headers = new Headers(SECURITY_HEADERS);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.append(key, value));
  }
  return new Response(null, { status: 204, headers });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: err.message, detail: err.detail }, err.status);
  }
  console.error("Unhandled API error:", err);
  return json({ error: "Internal server error." }, 500);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export type Params = Record<string, string>;

export interface RouteContext<Env> {
  request: Request;
  env: Env;
  params: Params;
  url: URL;
  /**
   * Schedules work to continue after the response has been sent. Required rather
   * than optional so that anything slow, email in particular, cannot be put in
   * the request path by accident.
   */
  waitUntil: (promise: Promise<unknown>) => void;
}

export type Handler<Env> = (ctx: RouteContext<Env>) => Promise<Response>;

interface Route<Env> {
  method: string;
  segments: string[];
  handler: Handler<Env>;
}

export class Router<Env> {
  private routes: Route<Env>[] = [];

  add(method: string, pattern: string, handler: Handler<Env>): this {
    this.routes.push({
      method,
      segments: pattern.split("/").filter(Boolean),
      handler,
    });
    return this;
  }

  get = (p: string, h: Handler<Env>) => this.add("GET", p, h);
  post = (p: string, h: Handler<Env>) => this.add("POST", p, h);
  patch = (p: string, h: Handler<Env>) => this.add("PATCH", p, h);
  delete = (p: string, h: Handler<Env>) => this.add("DELETE", p, h);

  /** Returns null when no route matches, so the caller can fall through. */
  match(method: string, pathname: string): { handler: Handler<Env>; params: Params } | null {
    const parts = pathname.split("/").filter(Boolean);
    let pathMatchedButNotMethod = false;

    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;

      const params: Params = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(":")) {
          params[seg.slice(1)] = decodeURIComponent(parts[i]);
        } else if (seg !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      if (route.method !== method) {
        pathMatchedButNotMethod = true;
        continue;
      }
      return { handler: route.handler, params };
    }

    if (pathMatchedButNotMethod) {
      throw new HttpError(405, `Method ${method} not allowed on this endpoint.`);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Request body parsing
// ---------------------------------------------------------------------------

export async function readJson<T = Record<string, unknown>>(
  request: Request,
): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw badRequest("Expected a JSON request body.");
  }
  try {
    return (await request.json()) as T;
  } catch {
    throw badRequest("Request body is not valid JSON.");
  }
}
