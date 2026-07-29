import type { OutcomeContracts } from "@engine/reactions/concepts/outcomes";
import { Refuse } from "@engine/reactions/concepts/refuse";
import { flow } from "@engine/reactions/context";
import { admitInput } from "../protocol/admit.ts";
import type { ContractShape, DomainErrorValue } from "../protocol/contract-shape.ts";
import type { InputContractDecl, RequestBoundaryActions } from "../protocol/endpoints.ts";
import { fromEnvelope } from "../protocol/envelope.ts";
import { FrameworkErrorCode, frameworkError } from "../protocol/errors.ts";
import type { InvocationResult } from "../protocol/errors.ts";
import { validateRuntimeValue } from "../protocol/validation.ts";
import type { EndpointValidator, EndpointValidators } from "../protocol/validation.ts";
import { isAborted, raceDeadline } from "@engine/utils/deadline";
import { RuntimeLifecycle } from "./lifecycle.ts";

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  signalListener?: () => void;
  outputValidator?: EndpointValidator;
  onInvalidOutput?: (errorClass: "ValidationFailure" | "ValidatorFault") => void;
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
  if (isAborted(signal)) return;
  const remaining = Math.max(0, deadline - performance.now());
  if (remaining === 0) return;

  const settled = dispatch.then(
    () => undefined,
    () => undefined,
  );
  await raceDeadline(settled, {
    timeoutMs: remaining,
    onTimeout: () => undefined,
    signal,
    onAbort: () => undefined,
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
  let settledOutput = output;
  if (!framework && !("error" in output) && pending.outputValidator !== undefined) {
    const validation = validateRuntimeValue(pending.outputValidator, output);
    if (!validation.ok) {
      try {
        pending.onInvalidOutput?.(validation.errorClass);
      } catch {
        // Integrity evidence is best-effort; it cannot take ownership of caller settlement.
      }
      settledOutput = { error: FrameworkErrorCode.INTERNAL_ERROR };
      framework = true;
    }
  }
  if (framework) frameworkResponses.add(settledOutput);
  pending.resolve(settledOutput);
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
    output?: {
      validator?: EndpointValidator;
      onInvalid?: (errorClass: "ValidationFailure" | "ValidatorFault") => void;
    },
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

      requests.set(requestId, {
        resolve,
        reject,
        timer,
        signal,
        signalListener,
        outputValidator: output?.validator,
        onInvalidOutput: output?.onInvalid,
      });
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
  /** Application-supplied runtime validators by endpoint path. */
  validators?: Readonly<Record<string, EndpointValidators>>;
  /** When supplied, reject paths outside the assembled public route set. */
  routes?: ReadonlySet<string>;
  /** Record an invalid successful result without exposing validator detail. */
  onInvalidOutput?: (event: {
    path: string;
    requestId: string;
    errorClass: "ValidationFailure" | "ValidatorFault";
  }) => void;
  /** Root admission, pending waits, drain state, and actual-flow quiescence. */
  lifecycle?: RuntimeLifecycle;
  /** Refresh standing reads before a new application-interface ask. */
  refresh?: () => void;
}): Invoker<C> {
  const {
    boundary,
    instrumented,
    contracts,
    validators,
    routes,
    onInvalidOutput,
    lifecycle,
    refresh,
  } = opts;
  const deadlinePolicy = lifecycle ?? new RuntimeLifecycle();

  return {
    async invoke(path, input, invokeOpts: InvokeOptions = {}) {
      const startedAt = performance.now();
      let requestId: string | undefined;
      let correlationId = invokeOpts.correlationId;
      const settle = <T extends InvocationResult>(result: T): T => {
        const resultClass = result.ok
          ? "success"
          : result.error.kind === "domain"
            ? "domain-error"
            : "framework-error";
        lifecycle?.events.emit({
          type: "invocation-settled",
          at: Date.now(),
          ...(requestId === undefined ? {} : { flow: requestId }),
          route: path,
          ...(correlationId === undefined ? {} : { correlationId }),
          result: resultClass,
          ...(!result.ok && result.error.kind === "framework"
            ? { frameworkCode: result.error.code }
            : {}),
          durationMs: performance.now() - startedAt,
        });
        return result;
      };
      if (isAborted(invokeOpts.signal)) {
        return settle(frameworkError(FrameworkErrorCode.ABORTED));
      }
      if (routes !== undefined && !routes.has(path)) {
        return settle(frameworkError(FrameworkErrorCode.NOT_FOUND, `Unknown endpoint: ${path}`));
      }
      refresh?.();
      // Validate the declared outer shape before recording an ask. Required
      // keys test presence, defaults fill absent keys, and then the endpoint's
      // application-supplied validator checks the complete admitted value.
      try {
        const contract = contracts?.[path];
        if (contract !== undefined) {
          const admitted = admitInput(contract, path, input);
          if (!admitted.ok) {
            return settle(frameworkError(FrameworkErrorCode.INVALID_INPUT, admitted.detail));
          }
          input = admitted.admitted as typeof input;
        }
        const inputValidator = validators?.[path]?.input;
        if (inputValidator !== undefined) {
          const validation = validateRuntimeValue(inputValidator, input);
          if (!validation.ok) {
            return settle(
              frameworkError(
                FrameworkErrorCode.INVALID_INPUT,
                validation.detail ?? `${path} failed runtime validation`,
              ),
            );
          }
        }
      } catch {
        return settle(
          frameworkError(FrameworkErrorCode.INVALID_INPUT, `${path} failed input admission`),
        );
      }
      const DEFAULT_TIMEOUT_MS = 30_000;
      const timeoutMs =
        invokeOpts.timeoutMs ?? lifecycle?.limits?.maxRequestDurationMs ?? DEFAULT_TIMEOUT_MS;
      const timeoutError = deadlinePolicy.validateTimeout(timeoutMs);
      if (timeoutError !== undefined) {
        return settle(frameworkError(FrameworkErrorCode.INVALID_INPUT, timeoutError));
      }
      requestId = crypto.randomUUID();
      correlationId ??= requestId;
      const rejection = lifecycle?.admit(requestId, path, correlationId);
      if (rejection !== undefined) {
        return settle(frameworkError(FrameworkErrorCode.UNAVAILABLE));
      }

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
        lifecycle?.abandon(requestId);
        return settle(frameworkError(FrameworkErrorCode.TRANSPORT_ERROR));
      }
      if (isAborted(invokeOpts.signal)) {
        lifecycle?.abandon(requestId);
        return settle(frameworkError(FrameworkErrorCode.ABORTED));
      }

      let responsePromise: Promise<Record<string, unknown>>;
      const deadline = performance.now() + timeoutMs;
      try {
        responsePromise = boundary.register(requestId, timeoutMs, invokeOpts.signal, {
          validator: validators?.[path]?.output,
          onInvalid: (errorClass) => onInvalidOutput?.({ path, requestId, errorClass }),
        });
      } catch {
        lifecycle?.abandon(requestId);
        return settle(frameworkError(FrameworkErrorCode.TRANSPORT_ERROR));
      }
      const response = responsePromise.then(
        (value) => {
          lifecycle?.pendingSettled(requestId);
          return { kind: "response", value } as const;
        },
        (error: unknown) => {
          lifecycle?.pendingSettled(requestId);
          return { kind: "response-error", error } as const;
        },
      );
      if (isAborted(invokeOpts.signal)) {
        boundary.cancel(requestId);
        lifecycle?.abandon(requestId);
        return settle(frameworkError(FrameworkErrorCode.ABORTED));
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
        lifecycle?.abandon(requestId);
        return settle(frameworkError(FrameworkErrorCode.TRANSPORT_ERROR));
      }

      if (first.kind === "response") {
        // Let the causal cascade finish when it can, but an accepted answer is
        // authoritative and cannot wait beyond the caller's original deadline.
        await waitForDispatch(dispatch, deadline, invokeOpts.signal);
        return settle(
          fromEnvelope(first.value, frameworkResponses.has(first.value) ? "framework" : "authored"),
        );
      }
      const settled = first.kind === "dispatched" ? await response : first;
      if (settled.kind === "response") {
        return settle(
          fromEnvelope(
            settled.value,
            frameworkResponses.has(settled.value) ? "framework" : "authored",
          ),
        );
      }
      try {
        throw settled.error;
      } catch (err) {
        if (err instanceof DOMException) {
          if (err.name === "TimeoutError") {
            return settle(frameworkError(FrameworkErrorCode.TIMED_OUT));
          }
          if (err.name === "AbortError") {
            return settle(frameworkError(FrameworkErrorCode.ABORTED));
          }
        }
        if (isAborted(invokeOpts.signal)) {
          return settle(frameworkError(FrameworkErrorCode.ABORTED));
        }
        return settle(frameworkError(FrameworkErrorCode.TRANSPORT_ERROR));
      }
    },
  } as Invoker<C>;
}
