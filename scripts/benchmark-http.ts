import { assemble, conceptSet } from "@mit-sdg/sync-engine/assembly";
import { createGateway } from "@mit-sdg/sync-engine/boundary";
import { createHttpHandler } from "@mit-sdg/sync-engine-http/handler";
import { httpPolicy } from "@mit-sdg/sync-engine-http/policy";

const warmupIterations = 20_000;
const iterationsPerSample = 100_000;
const sampleCount = 7;

const application = assemble({ conceptSet: conceptSet({}), composition: {} });
const gateway = createGateway({ application });
const policy = httpPolicy({ publicOrigin: "https://api.test" });
const handler = createHttpHandler({ application, gateway, policy });

async function run(iterations: number): Promise<{ elapsedMs: number; checksum: number }> {
  let checksum = 0;
  const started = performance.now();
  for (let index = 0; index < iterations; index++) {
    const response = await handler(
      new Request("https://api.test/missing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    checksum += response.status;
  }
  return { elapsedMs: performance.now() - started, checksum };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

await run(warmupIterations);
const samples: { elapsedMs: number; checksum: number }[] = [];
for (let sample = 0; sample < sampleCount; sample++) {
  samples.push(await run(iterationsPerSample));
}
const expectedChecksum = 404 * iterationsPerSample;
if (samples.some(({ checksum }) => checksum !== expectedChecksum)) {
  throw new Error(`HTTP benchmark produced an unexpected response checksum`);
}

const samplesMs = samples.map(({ elapsedMs }) => elapsedMs);
const medianMs = median(samplesMs);
console.log(
  JSON.stringify(
    {
      bun: Bun.version,
      scenario: "HTTP handler missing-route POST",
      warmupIterations,
      iterationsPerSample,
      samplesMs,
      medianMs,
      medianRequestsPerSecond: iterationsPerSample / (medianMs / 1_000),
    },
    null,
    2,
  ),
);
