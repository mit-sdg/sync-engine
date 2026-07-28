import type { OutcomeContracts } from "@engine/reactions/concepts/outcomes";
import { Refuse } from "@engine/reactions/concepts/refuse";
import { flow } from "@engine/reactions/context";
import { admitInput } from "../protocol/admit.ts";
import type { ContractShape, DomainErrorValue } from "../protocol/contract-shape.ts";
import type { InputContractDecl, RequestBoundaryActions } from "../protocol/endpoints.ts";
import { fromEnvelope } from "../protocol/envelope.ts";
import { FrameworkErrorCode, frameworkError } from "../protocol/errors.ts";
import type { InvocationResult } from "../protocol/errors.ts";

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  signalListener?: () => void;
}

const frameworkResponses = new WeakSet<Record<string, unknown>>();
const pendingRequests = new WeakMap<Requesting, Map<string, PendingRequest>>();

function requestsFor(boundary: Requesting): Map<string, PendingRequest> {
  const requests = pendingRequests.get(boundary);
  if (requests === undefined) throw new Error("Requesting boundary is not initialized.");
  return requests;
}

function disposePending(pending: PendingRequest): void {
  clearTimeout(pending.timer);
  if (pending.signalListener !== undefined && pending.signal !== undefined) {
    pending.signal.removeEventListener("abort", pending.signalListener);
  }
}

async function waitForDispatch(
  dispatch: Promise<unknown>,
  deadline: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted === true) return;
  const remaining = Math.max(0, deadline - performance.now());
  if (remaining === 0) return;

  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, remaining);
    signal?.addEventListener("abort", finish, { once: true });
    void dispatch.then(finish, finish);
  });
}

function settlePending(
  requests: Map<string, PendingRequest>,
  args: Record<string, unknown>,
  framework: boolean,
): Record<string, unknown> {
  const requestId = args.requestId;
  if (typeof requestId !== "string") {
    throw new Refuse("NOT_PENDING", { detail: "respond carries no requestId" });
  }
  const { requestId: _, ...output } = args;
  const pending = requests.get(requestId);
  if (pending === undefined) {
    throw new Refuse("NOT_PENDING", {
      detail: `request ${requestId} is not pending — already answered, timed out, or unknown`,
    });
  }
  requests.delete(requestId);
  disposePending(pending);
  if (framework) frameworkResponses.add(output);
  pending.resolve(output);
  return args;
}

export class Requesting {
  static readonly purpose =
    "Let the outside world ask for things and receive answers, so each authored answer belongs to one pending call and failed waits settle without forging one.";

  static readonly principle =
    "A call arrives and becomes pending. An answer travels back once; timeout or abort ends only the wait, while a quiescent interpreter failure returns an opaque internal error.";

  /**
   * `request` accepts every ask. `respond` accepts one answer for each pending
   * request and refuses later answers with `NOT_PENDING`. Declared outcomes
   * keep a returned body containing an `error` key distinct from a refusal.
   */
  static readonly outcomes: OutcomeContracts = {
    request: {},
    respond: { refusals: ["NOT_PENDING"] },
    respondFramework: { refusals: ["NOT_PENDING"] },
  };

  constructor() {
    pendingRequests.set(this, new Map());
  }

  request(args: Record<string, unknown>): Record<string, unknown> {
    return args;
  }

  respond(args: Record<string, unknown>): Record<string, unknown> {
    return settlePending(requestsFor(this), args, false);
  }

  /** Framework-only response channel; application authoring exposes only `respond`. */
  protected respondFramework(args: Record<string, unknown>): Record<string, unknown> {
    return settlePending(requestsFor(this), args, true);
  }

  register(
    requestId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const requests = requestsFor(this);
    if (requests.has(requestId)) {
      throw new Error(`Request ${requestId} is already pending.`);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = requests.get(requestId);
        if (pending !== undefined) {
          requests.delete(requestId);
          disposePending(pending);
        }
        reject(new DOMException("Timed out", "TimeoutError"));
      }, timeoutMs);

      let signalListener: (() => void) | undefined;
      if (signal !== undefined) {
        if (signal.aborted) {
          clearTimeout(timer);
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
          return;
        }
        signalListener = () => {
          const pending = requests.get(requestId);
          if (pending !== undefined) {
            requests.delete(requestId);
            disposePending(pending);
          }
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        };
        signal.addEventListener("abort", signalListener, { once: true });
      }

      requests.set(requestId, { resolve, reject, timer, signal, signalListener });
    });
  }

  cancel(requestId: string): void {
    const requests = requestsFor(this);
    const pending = requests.get(requestId);
    if (pending === undefined) return;
    requests.delete(requestId);
    disposePending(pending);
  }
}

/** Settle an unanswered request after its root flow encountered an interpreter failure. */
export function settleRequestInterpreterFailure(boundary: Requesting, requestId: string): boolean {
  const requests = requestsFor(boundary);
  if (!requests.has(requestId)) return false;
  settlePending(requests, { requestId, error: FrameworkErrorCode.INTERNAL_ERROR }, true);
  return true;
}

export interface Invoker<C extends ContractShape> {
  invoke<P extends keyof C & string>(
    path: P,
    input: C[P]["input"],
    options?: InvokeOptions,
  ): Promise<InvocationResult<C[P]["output"], DomainErrorValue<C[P]["error"]>>>;
}

export interface InvokeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** A trace token carried across gateway and application logs. */
  correlationId?: string;
}

export function createInvoker<C extends ContractShape = ContractShape>(opts: {
  boundary: Requesting;
  instrumented: RequestBoundaryActions;
  /** Declared input contracts by path; undeclared paths are unchecked. */
  contracts?: Record<string, InputContractDecl>;
  /** Refresh standing reads before a new application-interface ask. */
  refresh?: () => void;
}): Invoker<C> {
  const { boundary, instrumented, contracts, refresh } = opts;

  return {
    async invoke(path, input, invokeOpts: InvokeOptions = {}) {
      if (isAborted(invokeOpts.signal)) {
        return frameworkError(FrameworkErrorCode.ABORTED);
      }
      refresh?.();

      // Validate the declared outer shape before recording an ask. Required
      // keys test presence, so explicit null passes; defaults fill absent keys.
      const contract = contracts?.[path];
      if (contract !== undefined) {
        const admitted = admitInput(contract, path, input);
        if (!admitted.ok) {
          return frameworkError(FrameworkErrorCode.INVALID_INPUT, admitted.detail);
        }
        input = admitted.admitted as typeof input;
      }

      const requestId = crypto.randomUUID();
      const correlationId = invokeOpts.correlationId ?? requestId;
      const DEFAULT_TIMEOUT_MS = 30_000;
      const timeoutMs = invokeOpts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      let reqFn: (args: Record<string | symbol, unknown>) => unknown;
      let request: Record<string | symbol, unknown>;
      try {
        reqFn = instrumented.request as unknown as typeof reqFn;
        const resolvedInput = (input as Record<string, unknown> | undefined) ?? {};
        request = {
          ...resolvedInput,
          requestId,
          correlationId,
          path,
          [flow]: requestId,
        };
      } catch {
        return frameworkError(FrameworkErrorCode.TRANSPORT_ERROR);
      }
      if (isAborted(invokeOpts.signal)) {
        return frameworkError(FrameworkErrorCode.ABORTED);
      }

      let responsePromise: Promise<Record<string, unknown>>;
      const deadline = performance.now() + timeoutMs;
      try {
        responsePromise = boundary.register(requestId, timeoutMs, invokeOpts.signal);
      } catch {
        return frameworkError(FrameworkErrorCode.TRANSPORT_ERROR);
      }
      const response = responsePromise.then(
        (value) => ({ kind: "response", value }) as const,
        (error: unknown) => ({ kind: "response-error", error }) as const,
      );
      if (isAborted(invokeOpts.signal)) {
        boundary.cancel(requestId);
        return frameworkError(FrameworkErrorCode.ABORTED);
      }
      const dispatch = Promise.resolve()
        .then(() => reqFn(request))
        .then(
          () => ({ kind: "dispatched" }) as const,
          (error: unknown) => ({ kind: "dispatch-error", error }) as const,
        );
      const first = await Promise.race([dispatch, response]);

      if (first.kind === "dispatch-error") {
        boundary.cancel(requestId);
        return frameworkError(FrameworkErrorCode.TRANSPORT_ERROR);
      }

      if (first.kind === "response") {
        // Let the causal cascade finish when it can, but an accepted answer is
        // authoritative and cannot wait beyond the caller's original deadline.
        await waitForDispatch(dispatch, deadline, invokeOpts.signal);
        return fromEnvelope(
          first.value,
          frameworkResponses.has(first.value) ? "framework" : "authored",
        );
      }
      const settled = first.kind === "dispatched" ? await response : first;
      if (settled.kind === "response") {
        return fromEnvelope(
          settled.value,
          frameworkResponses.has(settled.value) ? "framework" : "authored",
        );
      }
      try {
        throw settled.error;
      } catch (err) {
        if (err instanceof DOMException) {
          if (err.name === "TimeoutError") return frameworkError(FrameworkErrorCode.TIMED_OUT);
          if (err.name === "AbortError") return frameworkError(FrameworkErrorCode.ABORTED);
        }
        if (isAborted(invokeOpts.signal)) {
          return frameworkError(FrameworkErrorCode.ABORTED);
        }
        return frameworkError(FrameworkErrorCode.TRANSPORT_ERROR);
      }
    },
  } as Invoker<C>;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
