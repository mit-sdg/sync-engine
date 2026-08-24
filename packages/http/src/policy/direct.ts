import { assertPortableRoutePath } from "@mit-sdg/sync-engine/boundary";
import type { HttpDirectRoute } from "./types.ts";

const SEGMENT = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

/** A direct route's literal segments and the input each `{name}` segment fills. */
export interface CompiledDirectRoute extends HttpDirectRoute {
  readonly segments: readonly string[];
  readonly parameters: readonly (string | undefined)[];
}

function literalPath(route: HttpDirectRoute): string {
  return route.path.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, "_");
}

export function compileDirectRoutes(
  declaration: readonly HttpDirectRoute[] | undefined,
): readonly CompiledDirectRoute[] | undefined {
  if (declaration === undefined) return undefined;
  if (declaration.length === 0) throw new Error("httpPolicy: direct must declare a route.");
  const compiled: CompiledDirectRoute[] = [];
  const seen = new Set<string>();
  for (const route of declaration) {
    if (route.method !== "GET") {
      throw new Error(`httpPolicy: direct route ${route.path} must use GET.`);
    }
    assertPortableRoutePath(literalPath(route), "httpPolicy: direct route path");
    assertPortableRoutePath(route.endpoint, "httpPolicy: direct route endpoint");
    if (route.status !== undefined && !Number.isInteger(route.status)) {
      throw new Error(`httpPolicy: direct route ${route.path} status must be an integer.`);
    }
    if (route.redirect === undefined && route.status === undefined) {
      throw new Error(
        `httpPolicy: direct route ${route.path} must state redirect or status; a direct route without either is a POST endpoint.`,
      );
    }
    const segments = Object.freeze(route.path.split("/").slice(1));
    const parameters = Object.freeze(segments.map((segment) => segment.match(SEGMENT)?.[1]));
    const named = parameters.filter((name): name is string => name !== undefined);
    if (new Set(named).size !== named.length) {
      throw new Error(`httpPolicy: direct route ${route.path} repeats a parameter name.`);
    }
    const shape = `${route.method} ${parameters.map((name, index) => (name === undefined ? segments[index] : "*")).join("/")}`;
    if (seen.has(shape)) throw new Error(`httpPolicy: direct routes collide on ${route.path}.`);
    seen.add(shape);
    compiled.push(Object.freeze({ ...route, segments, parameters }));
  }
  return Object.freeze(compiled);
}

/** The endpoint input a request path fills, or undefined when no direct route matches. */
export function matchDirectRoute(
  routes: readonly CompiledDirectRoute[] | undefined,
  method: string,
  path: string,
): { readonly route: CompiledDirectRoute; readonly input: Record<string, string> } | undefined {
  if (routes === undefined) return undefined;
  const parts = path.split("/").slice(1);
  for (const route of routes) {
    if (route.method !== method || route.segments.length !== parts.length) continue;
    const input: Record<string, string> = {};
    let matched = true;
    for (const [index, name] of route.parameters.entries()) {
      const part = parts[index] as string;
      if (name === undefined) {
        if (route.segments[index] !== part) {
          matched = false;
          break;
        }
        continue;
      }
      if (part === "") {
        matched = false;
        break;
      }
      try {
        input[name] = decodeURIComponent(part);
      } catch {
        matched = false;
        break;
      }
    }
    if (matched) return { route, input };
  }
  return undefined;
}
