// Runs once when the Node.js server starts (Next.js instrumentation hook). Prints the production config issues and
// ONE `[startup]` line so the real cwd and data directory can be read from Liara's runtime logs.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkProductionConfig, logConfigIssues, logStartupLine } = await import("./lib/deploy/startup-check");
  try {
    const report = await checkProductionConfig(process.env);
    logConfigIssues(report);
    logStartupLine(report);
  } catch {
    // Startup diagnostics must never stop the server from starting.
  }
}
