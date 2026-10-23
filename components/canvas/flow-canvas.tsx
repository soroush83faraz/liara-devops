"use client";

import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type AriaLabelConfig,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useShellStore } from "@/components/shell/shell-store";
import { isFailing, useHealthStore } from "@/lib/canvas/health-store";
import {
  clearLayout,
  edgeSides,
  layoutGraph,
  loadLayout,
  saveLayout,
  type SavedPositions,
} from "@/lib/canvas/layout";
import type { Overview } from "@/lib/canvas/types";
import { t } from "@/lib/i18n/t";
import { EnvEdge, type EnvFlowEdge } from "./env-edge";
import { NetworkGroup, type NetworkFlowNode } from "./network-group";
import { ServiceNode, type ServiceFlowNode } from "./service-node";
import { SIGNAL_COLOR, signalOf } from "./service-signal";

const nodeTypes = { service: ServiceNode, network: NetworkGroup };
const edgeTypes = { env: EnvEdge };

type FlowNode = ServiceFlowNode | NetworkFlowNode;

const DIRECTION_FA: Record<string, string> = {
  up: t("a11y.directionUp"),
  down: t("a11y.directionDown"),
  left: t("a11y.directionLeft"),
  right: t("a11y.directionRight"),
};

/** Every React Flow aria-label key, in Persian: nothing falls back to the library's English defaults. */
const ARIA_LABELS: AriaLabelConfig = {
  "node.a11yDescription.default": t("a11y.nodeDescription"),
  "node.a11yDescription.keyboardDisabled": t("a11y.nodeDescriptionKeyboardDisabled"),
  "node.a11yDescription.ariaLiveMessage": ({ direction, x, y }) =>
    t("a11y.nodeMoved", { direction: DIRECTION_FA[direction.toLowerCase()] ?? direction, x: Math.round(x), y: Math.round(y) }),
  "edge.a11yDescription.default": t("a11y.edgeDescription"),
  "handle.ariaLabel": t("a11y.handle"),
  "controls.ariaLabel": t("canvasMap.canvasLabel"),
  "controls.zoomIn.ariaLabel": t("canvasMap.zoomIn"),
  "controls.zoomOut.ariaLabel": t("canvasMap.zoomOut"),
  "controls.fitView.ariaLabel": t("canvasMap.fitView"),
  "controls.interactive.ariaLabel": t("canvasMap.lockView"),
  "minimap.ariaLabel": t("canvasMap.minimap"),
};

/** React Flow CSS variables mapped to the app's tokens (the tokens themselves switch for dark mode). */
export const FLOW_THEME = {
  "--xy-background-color": "var(--background)",
  "--xy-background-pattern-color": "var(--grid-dot)",
  "--xy-node-background-color": "var(--surface)",
  "--xy-node-color": "var(--foreground)",
  "--xy-node-boxshadow-selected-default": "none",
  "--xy-minimap-background-color": "var(--surface)",
  "--xy-controls-button-background-color": "var(--surface)",
  "--xy-controls-button-background-color-hover": "var(--surface-muted)",
  "--xy-controls-button-color": "var(--muted)",
  "--xy-controls-button-color-hover": "var(--foreground)",
  "--xy-controls-button-border-color": "var(--border)",
  "--xy-controls-box-shadow": "var(--shadow-soft)",
  "--xy-edge-label-background-color": "var(--surface)",
  "--xy-edge-label-color": "var(--foreground)",
  "--xy-attribution-background-color": "transparent",
} as CSSProperties;

const FIT_OPTIONS = { padding: 0.2, maxZoom: 1 };

/** Minimap tint: services by their live signal, network frames as faint outlines. */
function minimapColor(n: Node): string {
  if (n.type !== "service") return "transparent";
  const service = (n as ServiceFlowNode).data.service;
  return SIGNAL_COLOR[signalOf(service.status, isFailing(useHealthStore.getState().byService[service.id]))];
}
const minimapStroke = (n: Node): string => (n.type === "service" ? "transparent" : "var(--border-strong)");

function buildNodes(overview: Overview, saved: SavedPositions): FlowNode[] {
  const { frames, nodes } = layoutGraph(overview.services, overview.networks, saved);
  const byId = new Map(overview.services.map((s) => [s.id, s]));
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.frameId, (counts.get(n.frameId) ?? 0) + 1);
  const frameNodes: NetworkFlowNode[] = frames.map((f) => ({
    id: f.id,
    type: "network",
    position: { x: f.x, y: f.y },
    data: { name: f.name, count: counts.get(f.id) ?? 0, width: f.width, height: f.height },
    draggable: false,
    selectable: false,
    focusable: false,
    zIndex: 0,
    style: { width: f.width, height: f.height },
  }));
  let index = 0;
  const serviceNodes: ServiceFlowNode[] = nodes.flatMap((n) => {
    const service = byId.get(n.id);
    if (!service) return [];
    return [
      {
        id: n.id,
        type: "service" as const,
        parentId: n.frameId,
        extent: "parent" as const,
        position: { x: n.x, y: n.y },
        data: { service, index: index++ },
        zIndex: 1,
        ariaLabel: service.name,
      },
    ];
  });
  return [...frameNodes, ...serviceNodes];
}

/** Absolute top-left of a node (service positions are relative to their network frame). */
function absolutePosition(n: FlowNode, byId: ReadonlyMap<string, FlowNode>): { x: number; y: number } {
  const parent = n.parentId ? byId.get(n.parentId) : undefined;
  return { x: n.position.x + (parent?.position.x ?? 0), y: n.position.y + (parent?.position.y ?? 0) };
}

function buildEdges(overview: Overview, nodes: readonly FlowNode[]): EnvFlowEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return overview.edges
    .filter((e) => byId.has(e.from) && byId.has(e.to))
    .map((e) => {
      // Leave/enter through the sides that face each other, so the line never crosses a card's text.
      const sides = edgeSides(absolutePosition(byId.get(e.from)!, byId), absolutePosition(byId.get(e.to)!, byId));
      return { e, sides };
    })
    .map(({ e, sides }) => ({
      id: `${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      sourceHandle: `s-${sides.source}`,
      targetHandle: `t-${sides.target}`,
      type: "env" as const,
      data: { viaKey: e.viaKey },
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent)", width: 16, height: 16 },
      zIndex: 2,
    }));
}

function currentPositions(nodes: readonly FlowNode[]): SavedPositions {
  const out: SavedPositions = {};
  for (const n of nodes) if (n.type === "service") out[n.id] = { x: n.position.x, y: n.position.y };
  return out;
}

function FitOnSignal({ signal }: { signal: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (signal === 0) return;
    const id = requestAnimationFrame(() => void fitView({ ...FIT_OPTIONS, duration: 250 }));
    return () => cancelAnimationFrame(id);
  }, [signal, fitView]);
  return null;
}

function Flow({ overview, accountId, resetSignal }: { overview: Overview; accountId: string; resetSignal: number }) {
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const nodesRef = useRef<FlowNode[]>([]);
  const savedRef = useRef<SavedPositions | null>(null);
  const lastReset = useRef(resetSignal);

  // (Re)build when the data changes, keeping whatever positions the user has now. A reset drops them.
  useEffect(() => {
    if (savedRef.current === null) savedRef.current = loadLayout(accountId);
    let base = savedRef.current;
    if (lastReset.current !== resetSignal) {
      lastReset.current = resetSignal;
      clearLayout(accountId);
      base = savedRef.current = {};
    } else if (nodesRef.current.length > 0) {
      base = { ...base, ...currentPositions(nodesRef.current) };
    }
    const next = buildNodes(overview, base);
    nodesRef.current = next;
    setNodes(next);
  }, [overview, accountId, resetSignal]);

  const edges: Edge[] = useMemo(() => buildEdges(overview, nodes), [overview, nodes]);

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      nodesRef.current = next;
      return next;
    });
  }, []);

  const persist = useCallback(() => {
    // Re-run the layout with the dropped position: it keeps the drag but pushes apart cards that would overlap.
    const next = buildNodes(overview, currentPositions(nodesRef.current));
    nodesRef.current = next;
    setNodes(next);
    const positions = currentPositions(next);
    savedRef.current = positions;
    saveLayout(accountId, positions);
  }, [accountId, overview]);

  const onNodeClick: NodeMouseHandler<Node> = useCallback((_, node) => {
    if (node.type === "service") useShellStore.getState().openService(node.id);
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={persist}
      onNodeClick={onNodeClick}
      nodesConnectable={false}
      nodesFocusable
      // The product never deletes services from the canvas: no Delete/Backspace handling, no delete hint.
      deleteKeyCode={null}
      edgesFocusable={false}
      fitView
      // Never blow a small map up past 1:1 (four compact cards should look like cards, not posters).
      fitViewOptions={FIT_OPTIONS}
      minZoom={0.2}
      maxZoom={1.75}
      colorMode="system"
      // Theme tokens instead of React Flow's neutral black/white palette (navy surfaces in dark mode).
      style={FLOW_THEME}
      ariaLabelConfig={ARIA_LABELS}
      aria-label={t("canvasMap.canvasLabel")}
      proOptions={{ hideAttribution: false }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="var(--grid-dot)" />
      {/* Soft vignette between the dot grid (z -1) and the nodes (z 4): the eye settles on the middle of the map. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(120%_90%_at_50%_45%,transparent_55%,color-mix(in_oklab,var(--background)_85%,transparent)_100%)]"
      />
      <Controls
        showInteractive={false}
        position="bottom-left"
        className="overflow-hidden !rounded-sm border border-border [&>button]:!size-8 [&>button]:!border-border [&>button:last-child]:!border-b-0"
      />
      <MiniMap
        pannable
        zoomable
        position="bottom-right"
        // 140 x 96, translucent, above the attribution line; hidden on narrow screens.
        style={{ width: 140, height: 96, marginBottom: 30 }}
        nodeColor={minimapColor}
        nodeStrokeColor={minimapStroke}
        nodeStrokeWidth={6}
        nodeBorderRadius={14}
        maskColor="color-mix(in oklab, var(--background) 55%, transparent)"
        maskStrokeColor="color-mix(in oklab, var(--accent) 60%, transparent)"
        maskStrokeWidth={2}
        bgColor="color-mix(in oklab, var(--surface) 70%, transparent)"
        className="overflow-hidden rounded-sm border border-border shadow-[var(--shadow-soft)] max-md:hidden"
      />
      <FitOnSignal signal={resetSignal} />
    </ReactFlow>
  );
}

/** React Flow lays out in LTR coordinates, so the container is forced to `dir="ltr"`; node content is RTL again. */
export default function FlowCanvas(props: { overview: Overview; accountId: string; resetSignal: number }) {
  return (
    <div dir="ltr" className="size-full min-h-80">
      <ReactFlowProvider>
        <Flow {...props} />
      </ReactFlowProvider>
    </div>
  );
}
