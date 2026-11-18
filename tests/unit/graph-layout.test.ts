import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLayout, WIDTH, HEIGHT } from "@/lib/graph-layout";

const nodes = Array.from({ length: 15 }, (_, i) => ({ id: `n${i}`, title: `Note ${i}`, tags: [] }));
const edges = [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [6, 7], [0, 8], [8, 9], [10, 11], [11, 12], [12, 10], [13, 14]].map(([a, b]) => ({ source: `n${a}`, target: `n${b}` }));

test("every position has at most two decimals, so the server and the browser print the same text", () => {
  const layout = computeLayout(nodes, edges);
  assert.equal(layout.size, nodes.length);
  for (const [id, p] of layout) {
    for (const value of [p.x, p.y]) {
      assert.ok(Number.isFinite(value), id);
      assert.ok(Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, `${id}: ${value} has more than two decimals`);
    }
  }
});

test("the layout is the same every time and stays on the canvas", () => {
  const a = computeLayout(nodes, edges);
  const b = computeLayout(nodes, edges);
  assert.deepEqual([...a], [...b]);
  for (const p of a.values()) {
    assert.ok(p.x > -WIDTH && p.x < 2 * WIDTH && p.y > -HEIGHT && p.y < 2 * HEIGHT);
  }
});

test("no notes, one note and edges to missing notes do not break it", () => {
  assert.equal(computeLayout([], []).size, 0);
  assert.equal(computeLayout([nodes[0]], []).size, 1);
  assert.equal(computeLayout(nodes.slice(0, 2), [{ source: "n0", target: "ghost" }]).size, 2);
});
