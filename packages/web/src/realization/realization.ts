import {
  bindInterface,
  createGateway,
  type EndpointDef,
  type InterfaceDefinition,
} from "@mit-sdg/sync-engine/boundary";
import type { Assembly } from "@mit-sdg/sync-engine/assembly";
import {
  defineFetchRealization,
  type FetchClaim,
  type FetchRealization,
} from "@mit-sdg/sync-engine-http/realization";
import { compileHtml } from "@mit-sdg/sync-engine-rendering/compiled";
import type { RendererInvocation } from "@mit-sdg/sync-engine-rendering/language";

type AnyAssembly = Assembly<Record<string, new (...args: never[]) => object>>;

function documentFor(holder: string, fragment: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "</head>",
    `<body data-rendered-holder="${holder}">${fragment}</body>`,
    "</html>",
  ].join("");
}

/** Realize rendered endpoints in one interface as opening HTML documents. */
export function realize(options: {
  system: AnyAssembly;
  interface: InterfaceDefinition;
}): FetchRealization {
  const selected = bindInterface(options);
  const rendering = compileHtml(selected);
  const gateway = createGateway({ application: options.system });
  const endpoints = new Map<string, string[]>();

  for (const member of selected.members) {
    if (member.kind !== "endpoint") continue;
    const dependencies = selected.dependencies[member.identity] ?? [];
    if (dependencies.length === 0) continue;
    const path = (member.value as EndpointDef).path;
    const declarations = endpoints.get(path) ?? [];
    declarations.push(member.identity);
    endpoints.set(path, declarations);
  }

  const claims: readonly FetchClaim[] = Object.freeze(
    [...endpoints]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, declarations]) =>
        Object.freeze({
          method: "GET",
          path,
          declarations: Object.freeze(
            declarations.sort((left, right) => left.localeCompare(right)),
          ),
        }),
      ),
  );

  return defineFetchRealization({
    interface: selected.identity,
    claims,
    async fetch(request: Request): Promise<Response> {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      const path = new URL(request.url).pathname;
      if (!endpoints.has(path)) return new Response("Not found", { status: 404 });
      const answer = await gateway.invoke(path, {}, { signal: request.signal });
      if (!answer.ok)
        return new Response("The rendered endpoint refused the request.", { status: 500 });
      let formed;
      try {
        formed = rendering.form(answer.value as RendererInvocation);
      } catch {
        return new Response("The endpoint returned an invalid rendered answer.", { status: 500 });
      }
      return new Response(documentFor(formed.holder, formed.content.value), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });
}
