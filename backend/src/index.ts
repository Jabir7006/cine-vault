import { serve } from "@hono/node-server";
import { config } from "./config";
import { listenerUrl } from "./listener";
import { createApp } from "./app";
import { createRuntimeServices } from "./moviebox/runtime";

const app = createApp({
  allowedOrigins: config.allowedOrigins,
  accessToken: config.accessToken,
  ...createRuntimeServices(config),
});

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`cine-vault backend listening on ${listenerUrl(config.host, info.port)}`);
});
