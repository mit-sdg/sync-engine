import { randomUUID } from "node:crypto";
import { inspect as nodeInspect } from "node:util";

/** Node's custom-inspection hook, kept internal to engine instrumentation. */
export const inspectCustom = Symbol.for("nodejs.util.inspect.custom");

export function inspect(value: unknown): string {
  return nodeInspect(value, { depth: null, colors: false });
}

export function uuid(): string {
  return randomUUID();
}
