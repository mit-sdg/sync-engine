import { fileURLToPath } from "node:url";
import { artifactsCommand } from "./artifacts.ts";
import { checkDesignCommand } from "./check-design.ts";
import { checkCommand } from "./check.ts";
import { loadGeneratedApplication } from "./generated-config.ts";
import { describeError } from "@engine/utils/redaction";

const usage = `sync-engine verify [--config path] [--fail-on-warnings]
  Run the configured design, application, and artifact checks and report every result.
  The configuration path defaults to generated.config.ts.`;

export type VerificationStatus = "passed" | "failed" | "skipped";
export type VerificationStepName = "check-design" | "check" | "artifacts check";

export interface VerificationStepResult {
  readonly name: VerificationStepName;
  readonly status: VerificationStatus;
  readonly detail?: string;
}

export interface VerificationConfiguration {
  readonly status: "loaded" | "failed";
  readonly documents: readonly string[];
  readonly detail?: string;
}

/** A plain-data result that can also be rendered by a future machine-readable CLI format. */
export interface VerificationReport {
  readonly status: "passed" | "failed";
  readonly config: string;
  readonly configuration: VerificationConfiguration;
  readonly steps: readonly VerificationStepResult[];
}

interface VerifyOptions {
  configPath: string;
  failOnWarnings: boolean;
}

function parseOptions(args: readonly string[]): VerifyOptions {
  let configPath = "generated.config.ts";
  let hasConfigArgument = false;
  let failOnWarnings = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--config" && !hasConfigArgument) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) throw new Error(usage);
      configPath = value;
      hasConfigArgument = true;
      index += 1;
      continue;
    }
    if (argument === "--fail-on-warnings" && !failOnWarnings) {
      failOnWarnings = true;
      continue;
    }
    throw new Error(usage);
  }

  return { configPath, failOnWarnings };
}

async function runStep(
  name: VerificationStepName,
  operation: () => Promise<void>,
): Promise<VerificationStepResult> {
  try {
    await operation();
    return { name, status: "passed" };
  } catch (error) {
    return { name, status: "failed", detail: describeError(error) };
  }
}

function skippedStep(name: VerificationStepName, detail: string): VerificationStepResult {
  return { name, status: "skipped", detail };
}

function printDetail(detail: string): void {
  for (const line of detail.split("\n")) console.log(`    ${line}`);
}

function printReport(report: VerificationReport): void {
  console.log(`Verification report for ${report.config}`);
  if (report.configuration.status === "loaded") {
    console.log(`  configured design documents: ${report.configuration.documents.length}`);
  } else {
    console.log("  configured design documents: unavailable");
    printDetail(report.configuration.detail ?? "unknown configuration error");
  }

  for (const step of report.steps) {
    console.log(`  ${step.name}: ${step.status}`);
    if (step.detail !== undefined) printDetail(step.detail);
  }
  console.log(report.status === "passed" ? "Verification passed." : "Verification failed.");
}

function failedConfigurationReport(config: string, error: unknown): VerificationReport {
  const detail = describeError(error);
  return {
    status: "failed",
    config,
    configuration: { status: "failed", documents: [], detail },
    steps: [
      skippedStep("check-design", "the generated configuration could not be loaded"),
      skippedStep("check", "the generated configuration could not be loaded"),
      skippedStep("artifacts check", "the generated configuration could not be loaded"),
    ],
  };
}

/** Run the existing configured validation commands and retain every independent result. */
export async function verifyCommand(args: readonly string[]): Promise<VerificationReport> {
  const { configPath, failOnWarnings } = parseOptions(args);
  let documents: string[];
  try {
    const application = await loadGeneratedApplication(configPath, process.cwd());
    documents = application.design.documents.map((document) => fileURLToPath(document));
  } catch (error) {
    const report = failedConfigurationReport(configPath, error);
    printReport(report);
    return report;
  }

  const checkArguments = [
    "--config",
    configPath,
    ...(failOnWarnings ? ["--fail-on-warnings"] : []),
  ];
  const steps: VerificationStepResult[] = [
    documents.length === 0
      ? skippedStep("check-design", "no design documents are registered in the configuration")
      : await runStep("check-design", () => checkDesignCommand(documents)),
    await runStep("check", () => checkCommand(checkArguments)),
    await runStep("artifacts check", async () => {
      await artifactsCommand(["check", "--config", configPath]);
    }),
  ];
  const report: VerificationReport = {
    status: steps.some(({ status }) => status === "failed") ? "failed" : "passed",
    config: configPath,
    configuration: { status: "loaded", documents },
    steps,
  };
  printReport(report);
  return report;
}
