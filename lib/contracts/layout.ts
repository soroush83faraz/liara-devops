import { z } from "zod";
import { IsoDateTimeSchema, recordKey } from "./common";

/** Persisted canvas layout (node positions per account and project/network). */

export const LayoutNodeKeySchema = recordKey(/^[A-Za-z0-9:._-]{1,160}$/);

const Coordinate = z.number().min(-1e6).max(1e6);

export const CANVAS_LAYOUT_MAX_NODES = 1000;

export const CanvasLayoutSchema = z.strictObject({
  version: z.literal(1),
  nodes: z
    .record(LayoutNodeKeySchema, z.strictObject({ x: Coordinate, y: Coordinate }))
    .refine((r) => Object.keys(r).length <= CANVAS_LAYOUT_MAX_NODES, { message: "too many nodes" }),
  viewport: z.strictObject({ x: Coordinate, y: Coordinate, zoom: z.number().min(0.05).max(10) }).optional(),
  updatedAt: IsoDateTimeSchema,
});
export type CanvasLayout = z.infer<typeof CanvasLayoutSchema>;
