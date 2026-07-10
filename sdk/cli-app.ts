import type { InvocationResult } from "./errors.ts";
import type { Invoker } from "./invoke.ts";
import type { ContractShape } from "./client.ts";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Commands = Record<string, CliCommand<any>>;

export type CommandInput<TCommands extends Commands, K extends keyof TCommands> =
  TCommands[K] extends CliCommand<infer I> ? I : never;

export interface CliApp<TCommands extends Commands> {
  run(args: string[]): Promise<CliResult>;
  dispatch<K extends keyof TCommands>(
    command: K,
    input: CommandInput<TCommands, K>,
  ): Promise<CliResult>;
  help(): string;
}

export interface CliAppOptions {
  name?: string;
  version?: string;
  invoker?: Invoker<ContractShape>;
}

const DEFAULT_DESCRIPTION = "(no description)";

export function createCliApp<TCommands extends Commands>(
  commands: TCommands,
  options: CliAppOptions = {},
): CliApp<TCommands> {
  const { name = "", version = "" } = options;

  function buildHelp(): string {
    const header = [name, version].filter(Boolean).join(" ");
    let text = header ? `${header}\n\n` : "";

    const maxName = Math.max(...Object.keys(commands).map((k) => k.length), 8);
    const pad = (label: string) => label.padEnd(maxName);

    for (const [cmdName, cmd] of Object.entries(commands)) {
      text += `  ${pad(cmdName)}  ${(cmd as AnyCliCommand).description ?? DEFAULT_DESCRIPTION}\n`;
    }

    text += `  ${pad("help")}  Show this help message\n`;

    return text;
  }

  async function run(args: string[]): Promise<CliResult> {
    const commandName = args[0] ?? "help";
    if (commandName === "help" || commandName === "--help" || commandName === "-h") {
      return ok(buildHelp());
    }

    const command = commands[commandName] as AnyCliCommand | undefined;
    if (command === undefined) {
      return fail(`unknown command: ${commandName}\nRun '${name || "cli"} help' for usage.`);
    }

    const { positionals, options: opts } = parseArgs(args.slice(1));

    if (isEndpointCommand(command) && options.invoker !== undefined) {
      const parsed = command.parse(positionals, opts);
      if (!parsed.ok) return fail(parsed.message);
      const result = await options.invoker.invoke(command.path, parsed.value as never);
      return command.format(result);
    }

    const legacyCmd = command as CliCommand<unknown>;

    if (legacyCmd.parse !== undefined) {
      const parsed = legacyCmd.parse(positionals, opts);
      if ("exitCode" in (parsed as Partial<CliResult>)) {
        return parsed as CliResult;
      }
      try {
        return await legacyCmd.run(parsed as ReturnType<NonNullable<typeof legacyCmd.parse>>);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }

    try {
      return await legacyCmd.run({ positionals, options: opts } as unknown as Parameters<
        typeof legacyCmd.run
      >[0]);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  async function dispatch<K extends keyof TCommands>(
    commandName: K,
    input: CommandInput<TCommands, K>,
  ): Promise<CliResult> {
    const command = commands[commandName] as CliCommand<CommandInput<TCommands, K>>;
    try {
      return await command.run(input);
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
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
