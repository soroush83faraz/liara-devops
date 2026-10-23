// Unauthenticated liveness/readiness probe for Liara's healthCheck (curl --fail). Intentionally outside the
// session/CSRF route wrapper: the quality unit's route-wrapping guard must allowlist `/api/health`.
import { connection } from "next/server";
import { buildHealth } from "@/lib/deploy/health";

export async function GET() {
  await connection(); // opt out of build-time prerendering: uptime and disk state are request-time facts
  const { httpStatus, body } = await buildHealth(process.env);
  return Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
}
