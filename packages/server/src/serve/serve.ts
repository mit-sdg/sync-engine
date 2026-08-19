import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
import {
  fetchClaimMatches,
  fetchClaimsOverlap,
  isFetchRealization,
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

/** One open listener whose mounted realizations may change while it serves. */
export interface RunningServer {
  readonly url: string;
  /** Serve one more checked realization; its claims must not overlap a mounted one's. */
  mount(realization: FetchRealization): void;
  /** Stop serving a mounted realization; its open requests still finish. */
  unmount(realization: FetchRealization): void;
  /** Withdraw, stop admitting, and resolve once every admitted request finished. */
  close(): Promise<void>;
}

function assertMountable(realization: FetchRealization, mounted: Iterable<FetchRealization>): void {
  if (!isFetchRealization(realization)) {
    throw new TypeError(
      "Server.serve: every realization must be created by a Fetch realization package.",
    );
  }
  for (const claim of realization.claims) {
    for (const existing of mounted) {
      if (existing === realization) continue;
      const previous = existing.claims.find((candidate) => fetchClaimsOverlap(candidate, claim));
      if (previous !== undefined) {
        const exactCollision =
          previous.match === undefined && claim.match === undefined && previous.path === claim.path;
        const description = `${claim.method.toUpperCase()} ${claim.path}${claim.match === "prefix" ? "*" : ""}`;
        throw new Error(
          exactCollision
            ? `Server.serve: ${description} is claimed by both ${JSON.stringify(existing.interface)} and ${JSON.stringify(realization.interface)}.`
            : `Server.serve: ${description} overlaps claims by both ${JSON.stringify(existing.interface)} and ${JSON.stringify(realization.interface)}.`,
        );
      }
    }
  }
}

/** Open a listener over checked Fetch realizations; mounts may change while it serves. */
export async function open(options: ServeOptions): Promise<RunningServer> {
  if (options.realizations.length === 0) {
    throw new Error("Server.serve: supply at least one Fetch realization.");
  }
  const mounted: FetchRealization[] = [];
  for (const realization of options.realizations) {
    assertMountable(realization, mounted);
    mounted.push(realization);
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
      const route = mounted.find((realization) =>
        realization.claims.some((claim) => fetchClaimMatches(claim, request.method, path)),
      );
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

  let closing: Promise<void> | undefined;
  return Object.freeze({
    url: listener.url.toString(),
    mount(realization: FetchRealization): void {
      if (mounted.includes(realization)) return;
      assertMountable(realization, mounted);
      mounted.push(realization);
    },
    unmount(realization: FetchRealization): void {
      const at = mounted.indexOf(realization);
      if (at === -1) return;
      mounted.splice(at, 1);
    },
    close(): Promise<void> {
      closing ??= (async () => {
        accepting = false;
        await host.concepts.Serving.withdraw({ service });
        if (active === 0) resolveIdle?.();
        await listener.stop(false);
        await idle;
      })();
      return closing;
    },
  });
}

async function untilAborted(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) =>
    signal?.addEventListener("abort", () => resolve(), { once: true }),
  );
}

/** Serve checked Fetch realizations until host authority requests withdrawal. */
export async function serve(options: ServeOptions): Promise<void> {
  const running = await open(options);
  await untilAborted(options.signal);
  await running.close();
}
