import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config";
import { sources } from "./routes/sources";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: config.allowedOrigins,
    allowHeaders: ["Content-Type", "Authorization", "x-access-token", "Range"],
    exposeHeaders: ["Content-Length", "Content-Range", "Accept-Ranges"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

// Optional shared-secret guard for /api/* (enforced only when ACCESS_TOKEN is set).
app.use("/api/*", async (c, next) => {
  if (config.accessToken && c.req.header("x-access-token") !== config.accessToken) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

app.get("/health", (c) =>
  c.json({ ok: true, service: "cine-vault-backend", ts: Date.now() }),
);

app.route("/api/sources", sources);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`cine-vault backend listening on http://localhost:${info.port}`);
});
