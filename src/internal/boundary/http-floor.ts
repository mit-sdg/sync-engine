import type { Assembly } from "./assembly-facade.ts";
import { assemblyBehind } from "./assembly-registry.ts";
import type { InputContractDecl } from "./endpoints.ts";
import type { PublicErrorCategory } from "../reactions/concept-metadata.ts";
import { wireContracts } from "./wire.ts";
import type { WireContractsIR, WireType } from "./wire.ts";

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

export interface HttpFloor {
  origin: string;
  credential: HttpCredentialBinding;
}

const FIELD_NAME = /^[A-Za-z_$][\w$]*$/;

export function httpFloor(declaration: HttpFloor): HttpFloor {
  let origin: URL;
  try {
    origin = new URL(declaration.origin);
  } catch {
    throw new Error("httpFloor: origin must be an absolute HTTP or HTTPS origin.");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== declaration.origin.replace(/\/$/, "")
  ) {
    throw new Error("httpFloor: origin must contain only an HTTP or HTTPS origin.");
  }
  if (process.env.NODE_ENV === "production" && origin.protocol !== "https:") {
    throw new Error("httpFloor: production requires an HTTPS public origin for secure cookies.");
  }
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
    if (!path.startsWith("/")) throw new Error(`httpFloor: "${path}" is not an endpoint path.`);
  }
  if (new Set(credential.clear).size !== credential.clear.length) {
    throw new Error("httpFloor: credential clearing endpoints must be distinct.");
  }
  return Object.freeze({
    origin: origin.origin,
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

function publicCategory(
  code: string,
  categories: Readonly<Record<string, PublicErrorCategory>>,
): PublicErrorCategory | "INTERNAL_ERROR" {
  if (
    code === "INVALID_REQUEST" ||
    code === "UNAUTHORIZED" ||
    code === "FORBIDDEN" ||
    code === "NOT_FOUND" ||
    code === "CONFLICT"
  ) {
    return code;
  }
  switch (code) {
    case "INVALID_INPUT":
    case "BAD_JSON":
    case "BAD_STATUS":
      return "INVALID_REQUEST";
    case "INTERNAL_ERROR":
      return "INTERNAL_ERROR";
    default:
      return categories[code] ?? "INTERNAL_ERROR";
  }
}

export function projectHttpWire(
  wire: WireContractsIR,
  contracts: Readonly<Record<string, InputContractDecl>>,
  categories: Readonly<Record<string, PublicErrorCategory>>,
  floor: HttpFloor,
): WireContractsIR {
  const credential = floor.credential;
  return {
    endpoints: wire.endpoints.map((endpoint) => {
      const protectedRoute =
        contracts[endpoint.path]?.required?.includes(credential.input) ?? false;
      const errors = [
        ...new Set(endpoint.errors.map((code) => publicCategory(code, categories))),
      ].sort();
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
        errors,
        openError: false,
      };
    }),
    appWide: [...new Set(wire.appWide.map((code) => publicCategory(code, categories)))].sort(),
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
    .sort(([left], [right]) => left.localeCompare(right))
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
