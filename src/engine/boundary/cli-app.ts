import type { Invoker } from "./invocation/invoke.ts";
import type { ContractShape } from "./protocol/contract-shape.ts";
import type { InvocationResult } from "./protocol/errors.ts";

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function ok(stdout: string): CliResult {
  return { stdout: stdout.endsWith("\n") ? stdout : `${stdout}\n`, stderr: "", exitCode: 0 };
}

export function fail(stderr: string): CliResult {
  return { stdout: "", stderr: stderr.endsWith("\n") ? stderr : `${stderr}\n`, exitCode: 1 };
}

export interface ParsedArgs {
  positionals: string[];
  options: Record<string, string | boolean>;
}

export function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const eqIdx = token.indexOf("=");
    if (eqIdx >= 0) {
      const key = token.slice(2, eqIdx);
      options[key] = token.slice(eqIdx + 1);
      continue;
    }
    const key = token.slice(2);
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }

  return { positionals, options };
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function parseOk<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

export function parseFail(message: string): ParseResult<never> {
  return { ok: false, message };
}

export interface CliCommand<TInput = Record<string, string | boolean>> {
  description?: string;
  parse?(positionals: string[], options: Record<string, string | boolean>): TInput | CliResult;
  run(input: TInput): Promise<CliResult>;
}

export interface EndpointCliCommand<TInput, TOutput, TDomainError> {
  description?: string;
  path: string;
  parse(positionals: string[], options: Record<string, string | boolean>): ParseResult<TInput>;
  format(result: InvocationResult<TOutput, TDomainError>): CliResult;
}

type AnyCliCommand = CliCommand<unknown> | EndpointCliCommand<unknown, unknown, unknown>;

function isEndpointCommand(
  cmd: AnyCliCommand,
): cmd is EndpointCliCommand<unknown, unknown, unknown> {
  return (
    "format" in cmd &&
    typeof (cmd as EndpointCliCommand<unknown, unknown, unknown>).format === "function"
  );
}

// `any` preserves contextual inference for each command's independently inferred input.
// The values are narrowed before execution at the single adapter boundary below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Commands = Record<string, CliCommand<any> | EndpointCliCommand<any, any, any>>;

export type CommandInput<TCommands extends Commands, K extends keyof TCommands> =
  TCommands[K] extends CliCommand<infer I>
    ? I
    : TCommands[K] extends EndpointCliCommand<infer I, unknown, unknown>
      ? I
      : never;

export interface CliApp<TCommands extends Commands> {
  run(args: string[]): Promise<CliResult>;
  dispatch<K extends keyof TCommands>(
    command: K,
    input: CommandInput<TCommands, K>,
  ): Promise<CliResult>;
  help(): string;
}

export interface CliAppOptions<C extends ContractShape = ContractShape> {
  name?: string;
  version?: string;
  invoker?: Invoker<C>;
}

type CliExecutor = (
  positionals: string[],
  options: Record<string, string | boolean>,
) => Promise<CliResult>;

const DEFAULT_DESCRIPTION = "No description provided.";
const RESERVED_COMMAND_NAMES = new Set(["help", "--help", "-h"]);

function validateCommand(name: string, value: unknown): asserts value is AnyCliCommand {
  if (RESERVED_COMMAND_NAMES.has(name)) {
    throw new Error(`Command name "${name}" is reserved.`);
  }
  if (typeof value !== "object" || value === null) {
    throw new Error(`Command "${name}" must be an object.`);
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.description !== undefined && typeof candidate.description !== "string") {
    throw new Error(`Command "${name}" description must be a string.`);
  }

  if ("path" in candidate || "format" in candidate) {
    if (typeof candidate.path !== "string") {
      throw new Error(`Command "${name}" must define a string path.`);
    }
    if (typeof candidate.parse !== "function") {
      throw new Error(`Command "${name}" must define a parse function.`);
    }
    if (typeof candidate.format !== "function") {
      throw new Error(`Command "${name}" must define a format function.`);
    }
    return;
  }

  if (candidate.parse !== undefined && typeof candidate.parse !== "function") {
    throw new Error(`Command "${name}" parse must be a function.`);
  }
  if (typeof candidate.run !== "function") {
    throw new Error(`Command "${name}" must define a run function.`);
  }
}

export function createCliApp<TCommands extends Commands, C extends ContractShape = ContractShape>(
  commands: TCommands,
  options: CliAppOptions<C> = {},
): CliApp<TCommands> {
  const { name = "", version = "" } = options;

  function buildHelp(): string {
    const header = [name, version].filter(Boolean).join(" ");
    let text = header ? `${header}\n\n` : "";
    text += "Commands:\n";

    const maxName = Math.max(...Object.keys(commands).map((k) => k.length), 8);
    const pad = (label: string) => label.padEnd(maxName);

    for (const [cmdName, cmd] of Object.entries(commands)) {
      text += `  ${pad(cmdName)}  ${(cmd as AnyCliCommand).description ?? DEFAULT_DESCRIPTION}\n`;
    }

    text += `  ${pad("help")}  Show command help.\n`;

    return text;
  }

  async function executeCommand(
    command: AnyCliCommand,
    input: unknown,
    invoker: Invoker<C> | undefined,
  ): Promise<CliResult> {
    try {
      if (isEndpointCommand(command)) {
        if (invoker === undefined) {
          return fail(`Endpoint command "${command.path}" needs an invoker.`);
        }
        const result = await invoker.invoke(command.path as keyof C & string, input as never);
        return command.format(result);
      }
      return await (command as CliCommand<unknown>).run(input);
    } catch {
      return fail("Command failed.");
    }
  }

  function deriveExecutor(command: AnyCliCommand): CliExecutor {
    if (isEndpointCommand(command)) {
      const invoker = options.invoker;
      return async (positionals, opts) => {
        try {
          const parsed = command.parse(positionals, opts);
          if (!parsed.ok) return fail(parsed.message);
          return executeCommand(command, parsed.value, invoker);
        } catch {
          return fail("Command failed.");
        }
      };
    }

    const plainCommand = command as CliCommand<unknown>;

    if (plainCommand.parse !== undefined) {
      const parse = plainCommand.parse;
      return async (positionals, opts) => {
        try {
          const parsed = parse(positionals, opts);
          if (typeof parsed === "object" && parsed !== null && "exitCode" in parsed) {
            return parsed as CliResult;
          }
          return executeCommand(command, parsed, options.invoker);
        } catch {
          return fail("Command failed.");
        }
      };
    }

    return async (positionals, opts) => {
      return executeCommand(
        command,
        { positionals, options: opts } as unknown as Parameters<typeof plainCommand.run>[0],
        options.invoker,
      );
    };
  }

  const registeredCommands = new Map<string, AnyCliCommand>();
  const executors = new Map<string, CliExecutor>();
  for (const [cmdName, cmd] of Object.entries(commands)) {
    validateCommand(cmdName, cmd);
    registeredCommands.set(cmdName, cmd);
    executors.set(cmdName, deriveExecutor(cmd));
  }

  async function run(args: string[]): Promise<CliResult> {
    const commandName = args[0] ?? "help";
    if (commandName === "help" || commandName === "--help" || commandName === "-h") {
      return ok(buildHelp());
    }

    const executor = executors.get(commandName);
    if (executor === undefined) {
      return fail(`Unknown command: ${commandName}\nRun '${name || "cli"} help' to list commands.`);
    }

    const { positionals, options: opts } = parseArgs(args.slice(1));
    return executor(positionals, opts);
  }

  async function dispatch<K extends keyof TCommands>(
    commandName: K,
    input: CommandInput<TCommands, K>,
  ): Promise<CliResult> {
    const command = registeredCommands.get(commandName as string) as TCommands[K] | undefined;
    if (command === undefined) {
      return fail(
        `Unknown command: ${String(commandName)}\nRun '${name || "cli"} help' to list commands.`,
      );
    }
    return executeCommand(command, input, options.invoker);
  }

  function help(): string {
    return buildHelp();
  }

  return { run, dispatch, help };
}

export function command<TInput, TOutput, TDomainError>(
  endpointRef: { path: string },
  opts: {
    description?: string;
    parse: (
      positionals: string[],
      options: Record<string, string | boolean>,
    ) => ParseResult<TInput>;
    format: (result: InvocationResult<TOutput, TDomainError>) => CliResult;
  },
): EndpointCliCommand<TInput, TOutput, TDomainError> {
  return {
    description: opts.description,
    parse: opts.parse,
    format: opts.format,
    path: endpointRef.path,
  };
}
