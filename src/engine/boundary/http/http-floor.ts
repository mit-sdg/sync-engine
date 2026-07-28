import type { Assembly } from "../assembly/assembly-facade.ts";
import { assemblyBehind } from "../assembly/assembly-registry.ts";
import type { InputContractDecl } from "../protocol/endpoints.ts";
import { wireContracts } from "../wire/wire-contracts.ts";
import type { WireContractsIR } from "../wire/wire-contracts.ts";
import type { WireType } from "../wire/wire-types.ts";
import type { PublicErrorCategory } from "@engine/reactions/concepts/concept-metadata";
import type { ProductionHttpProfile } from "./http-profile.ts";
import { normalizeProductionHttpProfile, projectProductionHttpWire } from "./http-profile.ts";
import { assertPortableHttpPath } from "../protocol/http-path.ts";
import { ordinal } from "@engine/utils/ordinal";

export interface HttpCredentialBinding {
  name: string;
  input: string;
  issue: {
    path: string;
    output: string;
    expires: string;
  };
  clear: readonly string[];
}

export interface HttpFloor extends ProductionHttpProfile {
  credential: HttpCredentialBinding;
}

const FIELD_NAME = /^[A-Za-z_$][\w$]*$/;

export function httpFloor(declaration: HttpFloor): HttpFloor {
  const profile = normalizeProductionHttpProfile(declaration, "httpFloor", " for secure cookies");
  const credential = declaration.credential;
  for (const [seat, value] of [
    ["credential name", credential.name],
    ["credential input", credential.input],
    ["issued credential output", credential.issue.output],
    ["issued expiry output", credential.issue.expires],
  ] as const) {
    if (!FIELD_NAME.test(value)) throw new Error(`httpFloor: ${seat} "${value}" is not a field.`);
  }
  for (const path of [credential.issue.path, ...credential.clear]) {
    assertPortableHttpPath(path, "httpFloor: credential endpoint");
  }
  if (new Set(credential.clear).size !== credential.clear.length) {
    throw new Error("httpFloor: credential clearing endpoints must be distinct.");
  }
  return Object.freeze({
    ...profile,
    credential: Object.freeze({
      ...credential,
      issue: Object.freeze({ ...credential.issue }),
      clear: Object.freeze([...credential.clear]),
    }),
  });
}

function topLevelFields(type: WireType): Set<string> | undefined {
  if (type.kind === "object") return new Set(type.fields.map((field) => field.key));
  if (type.kind !== "union") return undefined;
  const alternatives = type.of.map(topLevelFields);
  if (alternatives.some((fields) => fields === undefined)) return undefined;
  const common = new Set(alternatives[0]);
  for (const fields of alternatives.slice(1)) {
    for (const key of common) if (!fields?.has(key)) common.delete(key);
  }
  return common;
}

export function validateHttpFloor(
  application: Assembly<Record<string, new (...args: never[]) => object>>,
  floor: HttpFloor,
): void {
  const assembled = assemblyBehind(application);
  const paths = new Set(Object.keys(assembled.publicInterface.routes));
  for (const path of [floor.credential.issue.path, ...floor.credential.clear]) {
    if (!paths.has(path)) throw new Error(`httpFloor: unknown endpoint path "${path}".`);
  }
  const protectedPaths = Object.entries(assembled.contracts).filter(([, contract]) =>
    contract.required?.includes(floor.credential.input),
  );
  if (protectedPaths.length === 0) {
    throw new Error(
      `httpFloor: no endpoint declares credential input "${floor.credential.input}".`,
    );
  }
  const wire = wireContracts(assembled.engine.exportReactions(), {
    contracts: assembled.contracts,
    inventories: assembled.engine.exportConcepts(),
  });
  const issuing = wire.endpoints.find(({ path }) => path === floor.credential.issue.path);
  const fields = issuing === undefined ? undefined : topLevelFields(issuing.output);
  for (const output of [floor.credential.issue.output, floor.credential.issue.expires]) {
    if (!fields?.has(output)) {
      throw new Error(
        `httpFloor: issuing endpoint "${floor.credential.issue.path}" has no output "${output}".`,
      );
    }
  }
}

function omitTopLevel(type: WireType, omitted: ReadonlySet<string>): WireType {
  if (type.kind === "object") {
    return { ...type, fields: type.fields.filter((field) => !omitted.has(field.key)) };
  }
  if (type.kind === "union") {
    return { ...type, of: type.of.map((item) => omitTopLevel(item, omitted)) };
  }
  return type;
}

export function projectHttpWire(
  wire: WireContractsIR,
  contracts: Readonly<Record<string, InputContractDecl>>,
  categories: Readonly<Record<string, PublicErrorCategory>>,
  floor: HttpFloor,
): WireContractsIR {
  const credential = floor.credential;
  const projected = projectProductionHttpWire(wire, categories);
  return {
    endpoints: projected.endpoints.map((endpoint) => {
      const protectedRoute =
        contracts[endpoint.path]?.required?.includes(credential.input) ?? false;
      return {
        ...endpoint,
        input: protectedRoute
          ? omitTopLevel(endpoint.input, new Set([credential.input]))
          : endpoint.input,
        output:
          endpoint.path === credential.issue.path
            ? omitTopLevel(
                endpoint.output,
                new Set([credential.issue.output, credential.issue.expires]),
              )
            : endpoint.output,
      };
    }),
    appWide: projected.appWide,
  };
}

export function projectAssemblyHttpWire(
  application: Assembly<Record<string, new (...args: never[]) => object>>,
  wire: WireContractsIR,
  floor: HttpFloor,
): WireContractsIR {
  validateHttpFloor(application, floor);
  const assembled = assemblyBehind(application);
  return projectHttpWire(wire, assembled.contracts, assembled.publicErrors, floor);
}

export function httpFloorReadBack(
  application: Assembly<Record<string, new (...args: never[]) => object>>,
  floor: HttpFloor,
): string {
  validateHttpFloor(application, floor);
  const assembled = assemblyBehind(application);
  const protectedPaths = Object.entries(assembled.contracts)
    .filter(([, contract]) => contract.required?.includes(floor.credential.input))
    .map(([path]) => path)
    .sort();
  const clearing =
    floor.credential.clear.length === 0
      ? "No endpoint clears the credential cookie after success."
      : floor.credential.clear.length === 1
        ? `A successful ${floor.credential.clear[0]} clears the credential cookie.`
        : `Successful calls to ${floor.credential.clear.join(", ")} clear the credential cookie.`;
  return [
    `HTTP floor public origin: ${floor.origin}.`,
    `Credential "${floor.credential.name}" binds cookie-only input "${floor.credential.input}" on ${protectedPaths.length} endpoints.`,
    `A successful ${floor.credential.issue.path} stores output "${floor.credential.issue.output}" in the credential cookie and reads its expiry from "${floor.credential.issue.expires}".`,
    clearing,
  ].join("\n");
}

export function floorReadBack(options: {
  application: Assembly<Record<string, new (...args: never[]) => object>>;
  conceptFloor: {
    name: string;
    instances: Record<string, object>;
    resources: readonly string[];
  };
  httpFloor: HttpFloor;
}): string {
  const implementations = Object.entries(options.conceptFloor.instances)
    .sort(([left], [right]) => ordinal(left, right))
    .map(([name, instance]) => {
      const implementation = Object.getPrototypeOf(instance)?.constructor?.name ?? "Unknown";
      return `  ${name}: ${implementation}`;
    });
  return [
    `Concept floor "${options.conceptFloor.name}".`,
    "Implementations:",
    ...implementations,
    `Resources: ${options.conceptFloor.resources.join(", ") || "none"}.`,
    "",
    httpFloorReadBack(options.application, options.httpFloor),
  ].join("\n");
}
