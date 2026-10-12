import { MovieBoxClient } from "../src/moviebox/client.js";
import { MovieBoxError } from "../src/moviebox/errors.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== "--live") {
    console.log("MovieBox verification skipped: live network access requires explicit --live.");
    return;
  }
  let client: MovieBoxClient | undefined;
  try {
    // Config alone loads environment; testable MovieBox modules do not import it.
    process.env.DOTENV_CONFIG_QUIET = "true";
    const { config } = await import("../src/config.js");
    client = new MovieBoxClient({ movieboxSecretHex: config.movieboxSecretHex });
    await client.init();
    await client.search("Inception");
    await client.search("Inception");
    console.log(JSON.stringify({ status: "ok", ...client.diagnostics() }));
  } catch (error) {
    const safe = error instanceof MovieBoxError ? error : undefined;
    console.log(JSON.stringify({ status: safe?.code === "setup" ? "blocked_setup" : "failed",
      code: safe?.code ?? "setup", httpStatus: safe?.status,
      ...(client?.diagnostics() ?? { httpAttempts: 0, loginRequests: 0, searchRequests: 0, sessionReuses: 0 }) }));
    // Do not log the error, config, tokens, headers, identity, response bodies, or key.
    process.exitCode = 1;
  }
}

await main();
