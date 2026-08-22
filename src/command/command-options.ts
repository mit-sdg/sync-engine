export type OutputFormat = "text" | "json";

type OperandRequirement = "none" | "required";

/** The deliberately small option vocabulary shared by validation commands. */
export interface CommandOptionSyntax {
  readonly config?: true;
  readonly failOnWarnings?: true;
  readonly format?: true;
  readonly showAdvisories?: true;
  readonly operands: OperandRequirement;
}

export interface ParsedCommandOptions {
  readonly configPath?: string;
  readonly failOnWarnings: boolean;
  readonly format: OutputFormat;
  readonly showAdvisories: boolean;
  readonly operands: readonly string[];
}

/**
 * Parse only the validation commands' shared flags and their path operands.
 * This is intentionally not a general command-line framework.
 */
export function parseCommandOptions(
  args: readonly string[],
  usage: string,
  syntax: CommandOptionSyntax,
): ParsedCommandOptions {
  let configPath: string | undefined;
  let failOnWarnings = false;
  let format: OutputFormat = "text";
  let showAdvisories = false;
  const operands: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--config" && syntax.config === true && configPath === undefined) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) throw new Error(usage);
      configPath = value;
      index += 1;
      continue;
    }
    if (argument === "--fail-on-warnings" && syntax.failOnWarnings === true && !failOnWarnings) {
      failOnWarnings = true;
      continue;
    }
    if (argument === "--format" && syntax.format === true && format === "text") {
      if (args[index + 1] !== "json") throw new Error(usage);
      format = "json";
      index += 1;
      continue;
    }
    if (argument === "--show-advisories" && syntax.showAdvisories === true && !showAdvisories) {
      showAdvisories = true;
      continue;
    }
    if (argument.startsWith("-")) throw new Error(usage);
    operands.push(argument);
  }

  if (syntax.operands === "none" && operands.length > 0) throw new Error(usage);
  if (syntax.operands === "required" && operands.length === 0) throw new Error(usage);
  return { configPath, failOnWarnings, format, showAdvisories, operands };
}
