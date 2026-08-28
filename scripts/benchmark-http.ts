import { assemble, conceptSet } from "@mit-sdg/sync-engine/assembly";
import { createGateway, endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { createHttpHandler } from "@mit-sdg/sync-engine-http/handler";
import { httpPolicy } from "@mit-sdg/sync-engine-http/policy";

const warmupIterations = 2_000;
const iterationsPerSample = 10_000;
const sampleCount = 7;
const origin = "https://api.test";
const requestInit = {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
} as const;

type Handler = (request: Request) => Response | Promise<Response>;

const Ping = endpoint("/ping", () => receive({}).then(respond({ ok: true })));
const application = assemble({ conceptSet: conceptSet({}), composition: { Ping } });
const gateway = createGateway({ application });
const syncEngineHandler = createHttpHandler({
  application,
  gateway,
  policy: httpPolicy({ publicOrigin: origin }),
});

const nativeHandler: Handler = async (request) => {
  if (request.method !== "POST" || new URL(request.url).pathname !== "/ping") {
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const contentType = request.headers.get("Content-Type");
  if (contentType !== null && !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  try {
    await request.json();
  } catch {
    return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  return Response.json({ ok: true });
};

interface Scenario {
  readonly name: string;
  readonly url: string;
  readonly handler: Handler;
  readonly expectedStatus: number;
}

const scenarios: readonly Scenario[] = [
  {
    name: "native successful responder",
    url: `${origin}/ping`,
    handler: nativeHandler,
    expectedStatus: 200,
  },
  {
    name: "sync-engine successful responder",
    url: `${origin}/ping`,
    handler: syncEngineHandler,
    expectedStatus: 200,
  },
  {
    name: "sync-engine missing route",
    url: `${origin}/missing`,
    handler: syncEngineHandler,
    expectedStatus: 404,
  },
];

async function run(
  scenario: Scenario,
  iterations: number,
): Promise<{ elapsedMs: number; checksum: number }> {
  let checksum = 0;
  const started = performance.now();
  for (let index = 0; index < iterations; index++) {
    const response = await scenario.handler(new Request(scenario.url, requestInit));
    checksum += response.status;
  }
  return { elapsedMs: performance.now() - started, checksum };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

const results: Array<{
  name: string;
  samplesMs: number[];
  medianMs: number;
  medianRequestsPerSecond: number;
}> = [];
for (const scenario of scenarios) {
  await run(scenario, warmupIterations);
  const samples: { elapsedMs: number; checksum: number }[] = [];
  for (let sample = 0; sample < sampleCount; sample++) {
    samples.push(await run(scenario, iterationsPerSample));
  }
  const expectedChecksum = scenario.expectedStatus * iterationsPerSample;
  if (samples.some(({ checksum }) => checksum !== expectedChecksum)) {
    throw new Error(`${scenario.name} produced an unexpected response checksum`);
  }
  const samplesMs = samples.map(({ elapsedMs }) => elapsedMs);
  const medianMs = median(samplesMs);
  results.push({
    name: scenario.name,
    samplesMs,
    medianMs,
    medianRequestsPerSecond: iterationsPerSample / (medianMs / 1_000),
  });
}

const nativeMedian = results[0]!.medianMs;
console.log(
  JSON.stringify(
    {
      bun: Bun.version,
      warmupIterations,
      iterationsPerSample,
      sampleCount,
      results: results.map((result) => ({
        ...result,
        latencyRelativeToNative: result.medianMs / nativeMedian,
      })),
    },
    null,
    2,
  ),
);
