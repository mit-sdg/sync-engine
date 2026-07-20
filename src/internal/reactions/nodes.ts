import type { ThenNode } from "./types.ts";

const NodeBrand: unique symbol = Symbol("NodeBrand");

export function brandReactionNode<T extends object>(node: T): T {
  Object.defineProperty(node, NodeBrand, { value: true, enumerable: false });
  return node;
}

function isReactionNode(value: unknown): value is ThenNode {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[NodeBrand] === true
  );
}

export function assertReactionNodes(nodes: readonly ThenNode[]): void {
  if (nodes.length === 0) throw new Error(".then(...) requires at least one request(...) node.");
  for (const node of nodes) {
    if (!isReactionNode(node)) {
      throw new Error(
        "a reaction is not a promise — pass request() nodes to .then() (did you `await` a when(...) chain?).",
      );
    }
  }
}
