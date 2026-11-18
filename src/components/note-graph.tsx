"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GraphNode, GraphEdge } from "@/repositories/link-repository";
import { WIDTH, HEIGHT, computeLayout, type Point } from "@/lib/graph-layout";

function NodeDot({
  node,
  pos,
  size,
  dimmed,
  toSvgPoint,
  onMove,
  onOpen,
}: {
  node: GraphNode;
  pos: Point;
  size: number;
  dimmed: boolean;
  toSvgPoint: (e: React.PointerEvent) => Point;
  onMove: (id: string, point: Point) => void;
  onOpen: (id: string) => void;
}) {
  const dragRef = useRef<{ moved: boolean } | null>(null);

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      className="cursor-pointer"
      opacity={dimmed ? 0.35 : 1}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { moved: false };
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return;
        dragRef.current.moved = true;
        onMove(node.id, toSvgPoint(e));
      }}
      onPointerUp={() => {
        const wasDrag = dragRef.current?.moved ?? false;
        dragRef.current = null;
        if (!wasDrag) onOpen(node.id);
      }}
    >
      <circle r={size} fill="var(--accent)" fillOpacity={0.88} />
      <text
        x={size + 5}
        y={4}
        fontSize={11}
        fill="var(--text-muted)"
        className="select-none"
      >
        {node.title}
      </text>
    </g>
  );
}

export function NoteGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const router = useRouter();
  const initialLayout = useMemo(() => computeLayout(nodes, edges), [nodes, edges]);
  const [positions, setPositions] = useState(initialLayout);
  const [hovered, setHovered] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const degree = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of edges) {
      counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
      counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
    }
    return counts;
  }, [edges]);

  const neighbors = useMemo(() => {
    if (!hovered) return null;
    const set = new Set<string>([hovered]);
    for (const edge of edges) {
      if (edge.source === hovered) set.add(edge.target);
      if (edge.target === hovered) set.add(edge.source);
    }
    return set;
  }, [hovered, edges]);

  function toSvgPoint(e: React.PointerEvent): Point {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function handleMove(id: string, point: Point) {
    setPositions((prev) => {
      const next = new Map(prev);
      next.set(id, point);
      return next;
    });
  }

  return (
    <div className="flex-1 overflow-hidden rounded-xl border border-border-subtle bg-surface">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-full w-full touch-none"
        onPointerLeave={() => setHovered(null)}
      >
        <g>
          {edges.map((edge, i) => {
            const a = positions.get(edge.source);
            const b = positions.get(edge.target);
            if (!a || !b) return null;
            const dimmed = neighbors ? !(neighbors.has(edge.source) && neighbors.has(edge.target)) : false;
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--border-strong)"
                strokeWidth={1}
                opacity={dimmed ? 0.15 : 0.7}
              />
            );
          })}
        </g>
        <g>
          {nodes.map((node) => {
            const pos = positions.get(node.id);
            if (!pos) return null;
            const size = 4 + Math.min(degree.get(node.id) ?? 0, 10) * 1.1;
            return (
              <g
                key={node.id}
                onPointerEnter={() => setHovered(node.id)}
              >
                <NodeDot
                  node={node}
                  pos={pos}
                  size={size}
                  dimmed={neighbors ? !neighbors.has(node.id) : false}
                  toSvgPoint={toSvgPoint}
                  onMove={handleMove}
                  onOpen={(id) => router.push(`/notes/${id}`)}
                />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
