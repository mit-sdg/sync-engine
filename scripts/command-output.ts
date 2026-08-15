import { execFileSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export interface QuietCommandOutput {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

export interface QuietCommandOptions {
  readonly cwd?: string;
  readonly diagnostics?: boolean;
  readonly diagnosticKeys?: Set<string>;
  readonly displayCommand?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdin?: "ignore" | "inherit";
  readonly timeout?: number;
}

export class QuietCommandFailure extends Error {
  readonly status: number;

  constructor(command: string, status: number, detail?: string) {
    super(`Command exited unsuccessfully: ${command}${detail === undefined ? "" : `: ${detail}`}`);
    this.name = "QuietCommandFailure";
    this.status = status;
  }
}

const ansi = new RegExp(`${String.fromCodePoint(0x1b)}\\[[0-?]*[ -/]*[@-~]`, "g");

export function stripAnsi(value: string): string {
  return value.replace(ansi, "");
}

function formatArgument(argument: string): string {
  return /^[\w@%+,./:=~-]+$/.test(argument) ? argument : JSON.stringify(argument);
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(formatArgument).join(" ");
}

function isUsefulDiagnostic(line: string): boolean {
  const plain = stripAnsi(line).trim();
  if (plain === "" || plain.startsWith("{")) return false;
  if (/^info [A-Z][A-Z0-9_]+:/.test(plain)) return true;
  if (/\b[1-9]\d* advisories?\b/i.test(plain)) return true;
  if (/^(?:npm )?warn(?:ing)?(?:\s|:)/i.test(plain)) return true;
  if (/^(?:error|fatal)(?:\s|:)/i.test(plain)) return true;
  if (/^(?:\(node:\d+\)\s+)?(?:Experimental|Deprecation)Warning\b/.test(plain)) return true;
  return (
    /\b(?:deprecated|deprecation|vulnerabilit(?:y|ies))\b/i.test(plain) &&
    !/\b(?:0|no)\s+(?:deprecated|deprecations?|vulnerabilit(?:y|ies))\b/i.test(plain)
  );
}

function writeDiagnostics(
  output: Buffer,
  destination: NodeJS.WriteStream,
  keys: Set<string>,
): void {
  for (const line of output.toString("utf8").split(/\r?\n/)) {
    if (!isUsefulDiagnostic(line)) continue;
    const key = stripAnsi(line).trim();
    if (keys.has(key)) continue;
    keys.add(key);
    destination.write(`${line}\n`);
  }
}

export function writeConciseDiagnostics(
  output: QuietCommandOutput,
  keys: Set<string> = new Set<string>(),
): void {
  writeDiagnostics(output.stdout, process.stdout, keys);
  writeDiagnostics(output.stderr, process.stderr, keys);
}

function writeCompleteStream(output: Buffer, destination: NodeJS.WriteStream): void {
  if (output.length === 0) return;
  destination.write(output);
  if (output.at(-1) !== 0x0a) destination.write("\n");
}

export function writeCompleteCommandOutput(output: QuietCommandOutput): void {
  writeCompleteStream(output.stdout, process.stdout);
  writeCompleteStream(output.stderr, process.stderr);
}

export function runQuietCommand(
  executable: string,
  args: readonly string[],
  options: QuietCommandOptions = {},
): QuietCommandOutput {
  const directory = mkdtempSync(resolve(tmpdir(), "sync-engine-command-"));
  const stdoutPath = resolve(directory, "stdout");
  const stderrPath = resolve(directory, "stderr");
  const stdoutDescriptor = openSync(stdoutPath, "w");
  const stderrDescriptor = openSync(stderrPath, "w");
  let failure: unknown;

  try {
    try {
      execFileSync(executable, [...args], {
        cwd: options.cwd,
        env: options.env,
        stdio: [options.stdin ?? "ignore", stdoutDescriptor, stderrDescriptor],
        ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
      });
    } catch (error) {
      failure = error;
    } finally {
      closeSync(stdoutDescriptor);
      closeSync(stderrDescriptor);
    }

    const output = {
      stdout: readFileSync(stdoutPath),
      stderr: readFileSync(stderrPath),
    };
    const command = formatCommand(options.displayCommand ?? executable, args);
    if (failure !== undefined) {
      const status = (failure as { status?: unknown }).status;
      console.error(`Command failed: ${command}`);
      writeCompleteCommandOutput(output);
      const exitStatus = typeof status === "number" && status > 0 ? status : 1;
      const detail =
        typeof status === "number" || !(failure instanceof Error) ? undefined : failure.message;
      throw new QuietCommandFailure(command, exitStatus, detail);
    }
    if (options.diagnostics !== false) {
      writeConciseDiagnostics(output, options.diagnosticKeys);
    }
    return output;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
