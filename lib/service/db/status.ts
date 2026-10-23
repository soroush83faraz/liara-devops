import { normalizeStatus, type ServiceStatus } from "../../../components/ui/status";

/** Scaled to zero = stopped (the user's power switch); otherwise whatever Liara reports, unknown stays unknown. */
export function mapDbStatus(db: { status?: string | null; scale?: number | null }): ServiceStatus {
  if (db.scale === 0) return "stopped";
  return normalizeStatus(db.status);
}
