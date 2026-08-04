import { assertPortableRoutePath, type WireProjectionFacts } from "@mit-sdg/sync-engine/boundary";
import type { InputContractDecl } from "@mit-sdg/sync-engine/boundary";
import type { WireContractsIR, WireType } from "@mit-sdg/sync-engine/tooling";
import { projectProductionHttpWire } from "./public-errors.ts";
import { normalizeProductionHttpProfile, type ProductionHttpProfile } from "./policy.ts";

export interface HttpCredentialBinding {
  readonly name: string;
  readonly input: string;
  readonly issue: {
    readonly path: string;
    readonly output: string;
    readonly expires: string;
  };
  readonly clear: readonly string[];
}

export interface HttpFloor extends ProductionHttpProfile {
  readonly credential: HttpCredentialBinding;
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
    assertPortableRoutePath(path, "httpFloor: credential endpoint");
  }
  if (credential.clear.includes(credential.issue.path)) {
    throw new Error(`httpFloor: "${credential.issue.path}" cannot issue and clear credentials.`);
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

export function credentialProtectedPaths(
  contracts: Readonly<Record<string, InputContractDecl>>,
  input: string,
): Set<string> {
  return new Set(
    Object.entries(contracts)
      .filter(([, contract]) => contract.required?.includes(input))
      .map(([path]) => path),
  );
}

export function validateHttpFloor(facts: WireProjectionFacts, floor: HttpFloor): void {
  const routes = facts.routes as Readonly<Record<string, InputContractDecl>>;
  const paths = new Set(Object.keys(routes));
  for (const path of [floor.credential.issue.path, ...floor.credential.clear]) {
    if (!paths.has(path)) throw new Error(`httpFloor: unknown endpoint path "${path}".`);
  }
  const protectedPaths = credentialProtectedPaths(routes, floor.credential.input);
  if (protectedPaths.size === 0) {
    throw new Error(
      `httpFloor: no endpoint declares credential input "${floor.credential.input}".`,
    );
  }
  const wire = facts.logicalWire as unknown as WireContractsIR;
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

export function projectHttpWire(facts: WireProjectionFacts, floor: HttpFloor): WireContractsIR {
  const wire = structuredClone(facts.logicalWire) as WireContractsIR;
  const routes = facts.routes as Readonly<Record<string, InputContractDecl>>;
  const credential = floor.credential;
  const projected = projectProductionHttpWire(wire, floor);
  const protectedPaths = credentialProtectedPaths(routes, credential.input);
  return {
    endpoints: projected.endpoints.map((endpoint) => ({
      ...endpoint,
      input: protectedPaths.has(endpoint.path)
        ? omitTopLevel(endpoint.input, new Set([credential.input]))
        : endpoint.input,
      output:
        endpoint.path === credential.issue.path
          ? omitTopLevel(
              endpoint.output,
              new Set([credential.issue.output, credential.issue.expires]),
            )
          : endpoint.output,
    })),
    appWide: projected.appWide,
  };
}
