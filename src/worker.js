// Worker entry point. Static files in public/ are served by Cloudflare directly;
// anything that isn't a file (the /api routes) comes here.
import { onRequestPost as postEvent } from "./api/event.js";
import { onRequestGet as getStats } from "./api/stats.js";
import { onRequestGet as getExport } from "./api/export.js";

const ROUTES = {
  "/api/event": { POST: postEvent },
  "/api/stats": { GET: getStats },
  "/api/export": { GET: getExport },
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const route = ROUTES[pathname];
    if (route) {
      const handler = route[request.method];
      if (!handler) return new Response("Method not allowed", { status: 405, headers: { allow: Object.keys(route).join(", ") } });
      return handler({ request, env, ctx });
    }
    return env.ASSETS.fetch(request);
  },
};
