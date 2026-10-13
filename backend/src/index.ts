import { serve } from "@hono/node-server";
import { config } from "./config";
import { createApp } from "./app";
import { createRuntimeServices } from "./moviebox/runtime";

const app = createApp({
  allowedOrigins: config.allowedOrigins,
  accessToken: config.accessToken,
  ...createRuntimeServices(),
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`cine-vault backend listening on http://localhost:${info.port}`);
});
