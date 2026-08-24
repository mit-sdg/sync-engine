import { describe, expect, test } from "vite-plus/test";
import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
import { createGateway, endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { httpPolicy, type HttpDirectRoute } from "@mit-sdg/sync-engine-http/policy";
import { createHttpHandler } from "@mit-sdg/sync-engine-http/handler";

class UnknownCode extends Error {}

class Shortening {
  resolve({ code }: { code: string }) {
    if (code !== "abc") throw new UnknownCode("unknown");
    return { target: "https://example.test/a/very/long/path" };
  }

  report({ code }: { code: string }) {
    if (code !== "abc") throw new UnknownCode("unknown");
    return { visits: 3 };
  }

  _visits({ code }: { code: string }) {
    return code === "abc" ? [{ visits: 3 }] : [];
  }
}

const specification = `# Shortening

## Purpose

Turn a long URL into a short code so that a compact link can be shared.

## Principle

A submitter shortens a URL and receives a code; following the code resolves the URL and
the submitter reads how often it was followed.

## Types

\`\`\`types
\`\`\`

## State

\`\`\`state
a set of Links with
  a code String
  a target String
  a visits Number
\`\`\`

## Actions

\`\`\`actions
resolve(code: String) : return (target: String)
  where code not in links
  then
    refuse UNKNOWN_CODE "No link has this code."
  where code is known
  then
    return target

report(code: String) : return (visits: Number)
  where code not in links
  then
    refuse UNKNOWN_CODE "No link has this code."
  where code is known
  then
    return visits
\`\`\`

## Queries

\`\`\`queries
_visits(code: String) : optional (visits: Number)
  returns the visit count of the link with this code, and no row when no link has it
\`\`\`
`;

function application() {
  const set = conceptSet({
    Shortening: registerConcept({
      class: Shortening,
      spec: specification,
      refusals: { UNKNOWN_CODE: UnknownCode },
    }),
  });
  const { Shortening: Links } = set.concepts;
  const Resolve = endpoint(
    "/resolve",
    ({ code, target }) =>
      receive({ code })
        .then(Links.resolve({ code }).responds({ target }))
        .then(respond({ target })),
    { input: { required: ["code"] } },
  );
  const Report = endpoint(
    "/report",
    ({ code, visits }) =>
      receive({ code }).then(Links.report({ code }).responds({ visits })).then(respond({ visits })),
    { input: { required: ["code"] } },
  );
  return assemble({ conceptSet: set, composition: { Resolve, Report } });
}

const follow: HttpDirectRoute = {
  method: "GET",
  path: "/{code}",
  endpoint: "/resolve",
  redirect: "target",
};

const stats: HttpDirectRoute = {
  method: "GET",
  path: "/{code}/stats",
  endpoint: "/report",
  status: 200,
};

function handlerWith(direct: readonly HttpDirectRoute[]) {
  const built = application();
  const gateway = createGateway({ application: built });
  const policy = httpPolicy({
    publicOrigin: "https://links.test",
    publicErrors: { UNKNOWN_CODE: "NOT_FOUND" },
    direct,
  });
  return createHttpHandler({ application: built, gateway, policy });
}

function get(path: string) {
  return new Request(`https://links.test${path}`, { method: "GET" });
}

describe("direct routes", () => {
  test("redirects a followed code to the value its endpoint returned", async () => {
    const response = await handlerWith([follow])(get("/abc"));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://example.test/a/very/long/path");
    expect(await response.text()).toBe("");
  });

  test("serves a direct route without a redirect as JSON", async () => {
    const response = await handlerWith([follow, stats])(get("/abc/stats"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ visits: 3 });
  });

  test("maps an endpoint refusal through the public error policy", async () => {
    const response = await handlerWith([follow])(get("/missing"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND" });
  });

  test("decodes a path parameter and rejects empty or malformed encodings", async () => {
    const handler = handlerWith([
      { method: "GET", path: "/{code}", endpoint: "/report", status: 200 },
    ]);
    expect((await handler(get("/%61bc"))).status).toBe(200);
    for (const path of ["/", "/%", "/%zz", "/%FF", "/%E0%A4%A"]) {
      expect((await handler(get(path))).status).toBe(400);
    }
  });

  test("leaves POST endpoints reachable and other methods refused", async () => {
    const handler = handlerWith([follow]);
    const posted = await handler(
      new Request("https://links.test/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "abc" }),
      }),
    );
    expect(await posted.json()).toEqual({ visits: 3 });
    expect(
      (await handler(new Request("https://links.test/abc", { method: "DELETE" }))).status,
    ).toBe(400);
  });

  test("freezes compiled route matching data", () => {
    const policy = httpPolicy({ direct: [follow] });
    const compiled = policy.direct?.[0] as HttpDirectRoute & {
      segments: readonly string[];
      parameters: readonly (string | undefined)[];
    };

    expect(Object.isFrozen(compiled.segments)).toBe(true);
    expect(Object.isFrozen(compiled.parameters)).toBe(true);
  });

  test("refuses a declaration that cannot be served", () => {
    expect(() => httpPolicy({ direct: [] })).toThrow("must declare a route");
    expect(() => httpPolicy({ direct: [{ ...follow, method: "POST" as never }] })).toThrow(
      "must use GET",
    );
    expect(() =>
      httpPolicy({ direct: [{ method: "GET", path: "/{code}", endpoint: "/resolve" }] }),
    ).toThrow("must state redirect or status");
    expect(() => httpPolicy({ direct: [{ ...follow, path: "/{code}/{code}" }] })).toThrow(
      "repeats a parameter name",
    );
    expect(() => httpPolicy({ direct: [follow, { ...follow, path: "/{other}" }] })).toThrow(
      "collide",
    );
  });
});
