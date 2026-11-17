// The note graph's layout (ROADMAP: /notes/graph). Pure: no React and no DOM, so it can be tested and run identically on the server and in the browser.
import type { GraphNode, GraphEdge } from "@/repositories/link-repository";

export const WIDTH = 900;
export const HEIGHT = 560;
const ITERATIONS = 300;
const REPULSION = 14000;
const SPRING_LENGTH = 110;
const SPRING_STRENGTH = 0.02;
const CENTER_STRENGTH = 0.008;
const DAMPING = 0.85;

export type Point = { x: number; y: number };

/**
 * A minimal force-directed layout, run once to a resting position rather than
 * animated every frame — a personal note graph is small enough (tens to a few
 * hundred nodes) that O(n²) repulsion over a couple hundred iterations settles
 * instantly, so there is no need for a physics library or a continuous
 * simulation loop.
 */
export function computeLayout(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Point> {
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const radius = Math.min(WIDTH, HEIGHT) / 3;

  const state = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  nodes.forEach((node, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
    state.set(node.id, {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    });
  });

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      const a = state.get(nodes[i].id)!;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = state.get(nodes[j].id)!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = Math.max(dx * dx + dy * dy, 1);
        const dist = Math.sqrt(distSq);
        const force = REPULSION / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    for (const edge of edges) {
      const a = state.get(edge.source);
      const b = state.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const force = (dist - SPRING_LENGTH) * SPRING_STRENGTH;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const node of nodes) {
      const p = state.get(node.id)!;
      p.vx = (p.vx + (cx - p.x) * CENTER_STRENGTH) * DAMPING;
      p.vy = (p.vy + (cy - p.y) * CENTER_STRENGTH) * DAMPING;
      p.x += p.vx;
      p.y += p.vy;
    }
  }

  const positions = new Map<string, Point>();
  // Rounded to two decimals: 300 iterations of floating-point arithmetic end a few units in the last place apart on the server's Node and the browser's
  // V8, and a position that differs in its 16th digit is a hydration mismatch (React logs it and keeps the server's value). A hundredth of a pixel
  // is invisible, and it makes the two sides print the same text.
  const round = (n: number) => Math.round(n * 100) / 100;
  for (const [id, p] of state) positions.set(id, { x: round(p.x), y: round(p.y) });
  return positions;
}

