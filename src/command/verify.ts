import { fileURLToPath } from "node:url";
import { artifactsCommand } from "./artifacts.ts";
import { checkDesignCommand } from "./check-design.ts";
import { checkCommand } from "./check.ts";
import { loadGeneratedApplication } from "./generated-config.ts";
import { describeError } from "@engine/utils/redaction";
import { parseCommandOptions } from "./command-options.ts";
import { writeJsonDocument } from "./diagnostic-report.ts";

const usage = `sync-engine verify [--config path] [--fail-on-warnings] [--show-advisories] [--format json]
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

/** The versioned plain-data result emitted directly by `verify --format json`. */
export interface VerificationReport {
  readonly format: "sync-engine.verification-report";
  readonly version: 1;
  readonly status: "passed" | "failed";
  readonly config: string;
  readonly configuration: VerificationConfiguration;
  readonly steps: readonly VerificationStepResult[];
}

async function runStep(
  name: VerificationStepName,
  operation: () => Promise<unknown>,
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
    format: "sync-engine.verification-report",
    version: 1,
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
  const options = parseCommandOptions(args, usage, {
    config: true,
    failOnWarnings: true,
    format: true,
    showAdvisories: true,
    operands: "none",
  });
  const configPath = options.configPath ?? "generated.config.ts";
  const stepRender = options.format === "json" ? "silent" : "text";
  let documents: string[];
  try {
    const application = await loadGeneratedApplication(configPath, process.cwd());
    documents = application.design.documents.map((document) => fileURLToPath(document));
  } catch (error) {
    const report = failedConfigurationReport(configPath, error);
    if (options.format === "json") writeJsonDocument(report);
    else printReport(report);
    return report;
  }

  const checkArguments = [
    "--config",
    configPath,
    ...(options.failOnWarnings ? ["--fail-on-warnings"] : []),
    ...(options.showAdvisories ? ["--show-advisories"] : []),
  ];
  const steps: VerificationStepResult[] = [
    documents.length === 0
      ? skippedStep("check-design", "no design documents are registered in the configuration")
      : await runStep("check-design", () => checkDesignCommand(documents, stepRender)),
    await runStep("check", () => checkCommand(checkArguments, stepRender)),
    await runStep("artifacts check", () =>
      artifactsCommand(["check", "--config", configPath], stepRender),
    ),
  ];
  const report: VerificationReport = {
    format: "sync-engine.verification-report",
    version: 1,
    status: steps.some(({ status }) => status === "failed") ? "failed" : "passed",
    config: configPath,
    configuration: { status: "loaded", documents },
    steps,
  };
  if (options.format === "json") writeJsonDocument(report);
  else printReport(report);
  return report;
}
