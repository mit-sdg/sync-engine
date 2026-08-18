import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
import {
  fetchClaimMatches,
  fetchClaimsOverlap,
  isFetchRealization,
  type FetchClaim,
  type FetchRealization,
} from "@mit-sdg/sync-engine-http/realization";
import {
  AdmissionAlreadyFinished,
  ServiceAlreadyExists,
  ServiceNotOpen,
  ServingMemoryConcept,
  WithdrawalAlreadyBegan,
  servingSpec,
} from "../serving/serving.ts";

const servingConceptSet = conceptSet({
  Serving: registerConcept({
    class: ServingMemoryConcept,
    spec: servingSpec,
    refusals: {
      SERVICE_ALREADY_EXISTS: ServiceAlreadyExists,
      SERVICE_NOT_OPEN: ServiceNotOpen,
      ADMISSION_ALREADY_FINISHED: AdmissionAlreadyFinished,
      WITHDRAWAL_ALREADY_BEGAN: WithdrawalAlreadyBegan,
    },
  }),
});

export interface ServerAddress {
  readonly hostname: string;
  readonly port: number;
}

export interface ServeOptions {
  readonly at: ServerAddress;
  readonly realizations: readonly FetchRealization[];
  readonly signal?: AbortSignal;
}

async function untilAborted(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) =>
    signal?.addEventListener("abort", () => resolve(), { once: true }),
  );
}

/** Serve checked Fetch realizations until host authority requests withdrawal. */
export async function serve(options: ServeOptions): Promise<void> {
  if (options.realizations.length === 0) {
    throw new Error("Server.serve: supply at least one Fetch realization.");
  }
  const routes: { claim: FetchClaim; realization: FetchRealization }[] = [];
  for (const realization of options.realizations) {
    if (!isFetchRealization(realization)) {
      throw new TypeError(
        "Server.serve: every realization must be created by a Fetch realization package.",
      );
    }
    for (const claim of realization.claims) {
      const previous = routes.find(({ claim: candidate }) => fetchClaimsOverlap(candidate, claim));
      if (previous !== undefined) {
        const exactCollision =
          previous.claim.match === undefined &&
          claim.match === undefined &&
          previous.claim.path === claim.path;
        const description = `${claim.method.toUpperCase()} ${claim.path}${claim.match === "prefix" ? "*" : ""}`;
        throw new Error(
          exactCollision
            ? `Server.serve: ${description} is claimed by both ${JSON.stringify(previous.realization.interface)} and ${JSON.stringify(realization.interface)}.`
            : `Server.serve: ${description} overlaps claims by both ${JSON.stringify(previous.realization.interface)} and ${JSON.stringify(realization.interface)}.`,
        );
      }
      routes.push({ claim, realization });
    }
  }

  const host = assemble({ conceptSet: servingConceptSet, composition: {} });
  const service = crypto.randomUUID();
  let accepting = true;
  let active = 0;
  let resolveIdle: (() => void) | undefined;
  const idle = new Promise<void>((resolve) => {
    resolveIdle = resolve;
  });
  const finishFloor = async (admission: string): Promise<void> => {
    await host.concepts.Serving.finish({ admission });
    active -= 1;
    if (!accepting && active === 0) resolveIdle?.();
  };

  const listener = Bun.serve({
    hostname: options.at.hostname,
    port: options.at.port,
    async fetch(request): Promise<Response> {
      if (!accepting) return new Response("Service unavailable", { status: 503 });
      const path = new URL(request.url).pathname;
      const route = routes.find(({ claim }) =>
        fetchClaimMatches(claim, request.method, path),
      )?.realization;
      if (route === undefined) return new Response("Not found", { status: 404 });
      const admission = crypto.randomUUID();
      const admitted = await host.concepts.Serving.admit({ service, admission });
      if ("error" in admitted) return new Response("Service unavailable", { status: 503 });
      active += 1;
      let response: Response;
      try {
        response = await route.fetch(request);
      } catch {
        await finishFloor(admission);
        return new Response("Internal server error", { status: 500 });
      }
      if (response.body === null) {
        await finishFloor(admission);
        return response;
      }
      const reader = response.body.getReader();
      let finished = false;
      const finish = async () => {
        if (finished) return;
        finished = true;
        await finishFloor(admission);
      };
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              controller.close();
              await finish();
            } else {
              controller.enqueue(next.value);
            }
          } catch (error) {
            controller.error(error);
            await finish();
          }
        },
        async cancel(reason) {
          await reader.cancel(reason);
          await finish();
        },
      });
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  });

  const opened = await host.concepts.Serving.open({
    service,
    interface: options.realizations
      .map((value) => value.interface)
      .sort()
      .join(","),
    address: listener.url.toString(),
  });
  if ("error" in opened) {
    await listener.stop(true);
    throw new Error("Server.serve: Serving refused the opened listener.");
  }

  await untilAborted(options.signal);
  accepting = false;
  await host.concepts.Serving.withdraw({ service });
  if (active === 0) resolveIdle?.();
  await listener.stop(false);
  await idle;
}
