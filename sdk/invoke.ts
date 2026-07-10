import type { Client, ContractShape } from "./client.ts";
import { createClient } from "./client.ts";
import type { RequestBoundaryActions } from "./endpoints.ts";
import { domainError, FrameworkErrorCode, frameworkError, success } from "./errors.ts";
import type { InvocationResult } from "./errors.ts";

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  signalListener?: () => void;
}

export class RequestBoundaryConcept {
  private pending = new Map<string, PendingRequest>();

  request(args: Record<string, unknown>): Record<string, unknown> {
    return args;
  }

  respond(args: Record<string, unknown>): Record<string, unknown> {
    const requestId = args.requestId;
    if (typeof requestId !== "string") return args;
    const { requestId: _, ...output } = args;
    const pending = this.pending.get(requestId);
    if (pending === undefined) return args;
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
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<InvocationResult<C[P]["output"], C[P]["error"]>>;
}

export function createInvoker(opts: {
  boundary: RequestBoundaryConcept;
  instrumented: RequestBoundaryActions;
}): Invoker<ContractShape> {
  const { boundary, instrumented } = opts;

  return {
    async invoke(path, input, invokeOpts: { signal?: AbortSignal; timeoutMs?: number } = {}) {
      const requestId = crypto.randomUUID();
      const timeoutMs = invokeOpts.timeoutMs ?? 30_000;

      let responsePromise: Promise<Record<string, unknown>>;
      try {
        responsePromise = boundary.register(requestId, timeoutMs, invokeOpts.signal);
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
        await reqFn({ requestId, path, ...resolvedInput });
      } catch (err) {
        boundary.cancel(requestId);
        return frameworkError(
          FrameworkErrorCode.TRANSPORT_ERROR,
          err instanceof Error ? err.message : String(err),
        );
      }

      try {
        const output = await responsePromise;
        const hasError = typeof output === "object" && output !== null && "error" in output;

        if (hasError) {
          return domainError(output.error);
        }

        return success(output as Record<string, unknown>);
      } catch (err) {
        if (err instanceof DOMException) {
          if (err.name === "TimeoutError") return frameworkError(FrameworkErrorCode.TIMED_OUT);
          if (err.name === "AbortError") return frameworkError(FrameworkErrorCode.TIMED_OUT);
        }
        return frameworkError(
          FrameworkErrorCode.TRANSPORT_ERROR,
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  };
}

export function createLocalClient<C extends ContractShape>(options: {
  invoker: Invoker<C>;
}): Client<C> {
  return createClient<C>({
    transport: async (request) => {
      const result = await options.invoker.invoke(
        request.path as keyof C & string,
        request.input as never,
      );
      return result;
    },
  });
}
