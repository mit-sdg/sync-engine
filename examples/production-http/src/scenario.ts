import { createProductionHttpClient } from "./client.ts";
import { buildProductionHttp } from "./edge.ts";

function inProcessFetch(handler: (request: Request) => Promise<Response>, keepCookie = false) {
  let cookie: string | undefined;
  return async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (cookie !== undefined) headers.set("Cookie", cookie);
    const response = await handler(new Request(input, { ...init, headers }));
    if (keepCookie) {
      const setCookie = response.headers.get("Set-Cookie");
      if (setCookie?.includes("Max-Age=0")) cookie = undefined;
      else if (setCookie !== null) cookie = setCookie.split(";", 1)[0];
    }
    return response;
  };
}

export async function runScenario() {
  const { floorHandler, profileHandler } = buildProductionHttp();
  const sessions = createProductionHttpClient({
    baseUrl: "https://production-http.test/api",
    fetch: inProcessFetch(floorHandler, true),
  });
  const names = createProductionHttpClient({
    baseUrl: "https://production-http.test/api",
    fetch: inProcessFetch(profileHandler),
  });
  const started = await sessions.sessions.start({});
  const current = await sessions.sessions.current({});
  const claimed = await names.names.claim({ name: "atlas" });
  const duplicate = await names.names.claim({ name: "atlas" });
  const ended = await sessions.sessions.end({});

  return {
    started,
    current,
    claimed,
    duplicate,
    ended,
  };
}

if (import.meta.main) console.log(JSON.stringify(await runScenario(), null, 2));
