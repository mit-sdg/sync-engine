import { buildProductionHttp } from "./edge.ts";

function post(path: string, body: unknown, cookie?: string): Request {
  return new Request(`https://production-http.test/api${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie === undefined ? {} : { Cookie: cookie }),
    },
    body: JSON.stringify(body),
  });
}

export async function runScenario() {
  const { floorHandler, profileHandler } = buildProductionHttp();
  const started = await floorHandler(post("/sessions/start", { user: "Maya" }));
  const cookie = started.headers.get("Set-Cookie")?.split(";", 1)[0];
  if (cookie === undefined) throw new Error("Session cookie was not issued.");

  const current = await floorHandler(post("/sessions/current", {}, cookie));
  const claimed = await profileHandler(post("/names/claim", { name: "atlas" }));
  const duplicate = await profileHandler(post("/names/claim", { name: "atlas" }));
  const ended = await floorHandler(post("/sessions/end", {}, cookie));

  return {
    started: await started.json(),
    current: await current.json(),
    claimed: await claimed.json(),
    duplicate: await duplicate.json(),
    ended: await ended.json(),
  };
}

if (import.meta.main) console.log(JSON.stringify(await runScenario(), null, 2));
