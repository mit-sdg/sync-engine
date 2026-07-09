/**
 * # CLI transport adapter
 *
 * Spawns a command-line process for each client request, writes the request as
 * JSON to stdin, and reads the response from stdout. Treats the CLI process as
 * an outside-world conversation boundary compatible with the generic
 * {@link ClientTransport} protocol.
 *
 * ## Protocol
 *
 * - Write `{ "path": string, "input": unknown }` as one JSON line to stdin.
 * - Read stdout as one JSON response object.
 * - Stderr is treated as diagnostic detail, not the primary response channel.
 */

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { FrameworkErrorCode } from "./error-codes.ts";
import type { Client, ClientTransport, ContractShape } from "./client.ts";
import { createClient } from "./client.ts";

/** Options for {@link createCliTransport} and {@link createCliClient}. */
export interface CliClientOptions {
  /** The command to spawn. */
  command: string;
  /** Arguments passed to the command. */
  args?: string[];
  /** Working directory for the spawned process. */
  cwd?: string;
  /** Environment variables merged into the process environment. */
  env?: Record<string, string | undefined>;
  /** Maximum time in milliseconds to wait for the process to exit. */
  timeoutMs?: number;
}

type CliProcessResult =
  | { kind: "exit"; code: number | null; signal: string | null }
  | { kind: "timeout" }
  | { kind: "process-error"; error: Error };

/**
 * Creates a CLI {@link ClientTransport} that spawns a fresh process per
 * request. The returned transport can be passed directly to
 * {@link createClient}.
 */
export function createCliTransport(options: CliClientOptions): ClientTransport {
  const { command, args = [], cwd, env, timeoutMs } = options;

  return async (request) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      return {
        error: FrameworkErrorCode.PROCESS_ERROR,
        detail: `Command "${command}" failed to start: ${describe(e)}.`,
      };
    }

    let stdout = "";
    let stderr = "";
    const chunks: Buffer[] = [];

    child.stdout?.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.stdin?.on("error", () => {
      // A fast process exit can close stdin before the request is fully written.
    });
    child.stdin?.write(`${JSON.stringify(request)}\n`);
    child.stdin?.end();

    const result = await new Promise<CliProcessResult>((resolve) => {
      let settled = false;
      const finish = (value: CliProcessResult) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve(value);
      };
      const timer =
        timeoutMs !== undefined
          ? setTimeout(() => {
              child.kill();
              finish({ kind: "timeout" });
            }, timeoutMs)
          : undefined;

      child.on("close", (code, signal) => {
        finish({ kind: "exit", code, signal });
      });

      child.on("error", (error) => {
        finish({ kind: "process-error", error });
      });
    });

    stdout = Buffer.concat(chunks).toString();

    if (result.kind === "timeout") {
      return {
        error: FrameworkErrorCode.COMMAND_TIMED_OUT,
        detail: `Command "${command}" timed out after ${timeoutMs}ms.`,
      };
    }

    if (result.kind === "process-error") {
      return {
        error: FrameworkErrorCode.PROCESS_ERROR,
        detail: `Command "${command}" failed to start: ${describe(result.error)}.`,
      };
    }

    if (result.code !== 0) {
      const exit =
        result.code === null
          ? `terminated by signal ${result.signal ?? "unknown"}`
          : `exited with code ${result.code}`;
      return {
        error: FrameworkErrorCode.COMMAND_FAILED,
        detail: `Command "${command}" ${exit}.${stderr ? ` stderr: ${stderr.trim()}` : ""}`,
      };
    }

    if (stdout.trim() === "") {
      return {};
    }

    try {
      return JSON.parse(stdout);
    } catch {
      return {
        error: FrameworkErrorCode.BAD_JSON,
        detail: `Invalid JSON output from "${command}".`,
      };
    }
  };
}

/** Renders an unknown thrown value as a short string for error envelopes. */
function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Convenience that composes {@link createCliTransport} with
 * {@link createClient}. Equivalent to:
 *
 * ```ts
 * createClient<C>({ transport: createCliTransport(options) })
 * ```
 */
export function createCliClient<C extends ContractShape>(options: CliClientOptions): Client<C> {
  return createClient<C>({ transport: createCliTransport(options) });
}
