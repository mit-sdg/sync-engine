import { type OutcomeContracts, Refuse } from "../reactions/index.ts";
import { admitInput } from "./admit.ts";
import type { ContractShape, DomainErrorValue } from "./client.ts";
import type { InputContractDecl, RequestBoundaryActions } from "./endpoints.ts";
import { fromEnvelope } from "./envelope.ts";
import { FrameworkErrorCode, frameworkError } from "./errors.ts";
import type { InvocationResult } from "./errors.ts";

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  signalListener?: () => void;
}

export class Requesting {
  static readonly purpose =
    "Let the outside world ask for things and receive answers, so each answer belongs to one pending call and unanswered calls remain unanswered.";

  static readonly principle =
    "A call arrives and becomes pending. When something answers, the reply travels back and a second answer is refused. If the caller times out or aborts first, waiting ends without recording an answer.";

  /**
   * `request` accepts every ask. `respond` accepts one answer for each pending
   * request and refuses later answers with `NOT_PENDING`. Declared outcomes
   * keep a returned body containing an `error` key distinct from a refusal.
   */
  static readonly outcomes: OutcomeContracts = {
    request: {},
    respond: { refusals: ["NOT_PENDING"] },
  };

  private pending = new Map<string, PendingRequest>();

  request(args: Record<string, unknown>): Record<string, unknown> {
    return args;
  }

  respond(args: Record<string, unknown>): Record<string, unknown> {
    const requestId = args.requestId;
    if (typeof requestId !== "string") {
      throw new Refuse("NOT_PENDING", { detail: "respond carries no requestId" });
    }
    const { requestId: _, ...output } = args;
    const pending = this.pending.get(requestId);
    if (pending === undefined) {
      throw new Refuse("NOT_PENDING", {
        detail: `request ${requestId} is not pending — already answered, timed out, or unknown`,
      });
    }
    clearTimeout(pending.timer);
    if (pending.signalListener !== undefined && pending.signal !== undefined) {
      pending.signal.removeEventListener("abort", pending.signalListener);
    }
    this.pending.delete(requestId);
    pending.resolve(output);
    return args;
  }

  register(
    requestId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
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
          clearTimeout(timer);
          this.pending.delete(requestId);
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        };
        signal.addEventListener("abort", signalListener, { once: true });
      }

      this.pending.set(requestId, { resolve, reject, timer, signal, signalListener });
    });
  }

  cancel(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    if (pending.signalListener !== undefined && pending.signal !== undefined) {
      pending.signal.removeEventListener("abort", pending.signalListener);
    }
    this.pending.delete(requestId);
  }
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
      if (invokeOpts.signal?.aborted === true) {
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
      const timeoutMs = invokeOpts.timeoutMs ?? 30_000;

      let responsePromise: Promise<Record<string, unknown>>;
      try {
        responsePromise = boundary.register(requestId, timeoutMs, invokeOpts.signal);
        void responsePromise.catch(() => undefined);
      } catch (err) {
        return frameworkError(
          FrameworkErrorCode.TIMED_OUT,
          err instanceof Error ? err.message : String(err),
        );
      }

      try {
        const reqFn = instrumented.request as unknown as (
          args: Record<string, unknown>,
        ) => Promise<Record<string, unknown>>;
        const resolvedInput = (input as Record<string, unknown> | undefined) ?? {};
        await reqFn({ ...resolvedInput, requestId, correlationId, path });
      } catch (err) {
        boundary.cancel(requestId);
        return frameworkError(
          FrameworkErrorCode.TRANSPORT_ERROR,
          err instanceof Error ? err.message : String(err),
        );
      }

      try {
        return fromEnvelope(await responsePromise);
      } catch (err) {
        if (err instanceof DOMException) {
          if (err.name === "TimeoutError") return frameworkError(FrameworkErrorCode.TIMED_OUT);
          if (err.name === "AbortError") return frameworkError(FrameworkErrorCode.ABORTED);
        }
        if (isAborted(invokeOpts.signal)) {
          return frameworkError(FrameworkErrorCode.ABORTED);
        }
        return frameworkError(
          FrameworkErrorCode.TRANSPORT_ERROR,
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  } as Invoker<C>;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export { createLocalClient } from "./local-client.ts";
