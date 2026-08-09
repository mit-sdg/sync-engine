import type { InputContractDecl, WireProjectionFacts } from "@mit-sdg/sync-engine/boundary";
import type { WireContractsIR, WireType } from "@mit-sdg/sync-engine/tooling";
import type { HttpCookieIssue, HttpCookiePolicy, HttpPolicy } from "./policy.ts";
import { projectHttpErrors } from "./public-errors.ts";

export function cookieIssues(cookie: HttpCookiePolicy): readonly HttpCookieIssue[] {
  return Array.isArray(cookie.issue) ? cookie.issue : [cookie.issue as HttpCookieIssue];
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

export function cookieProtectedPaths(
  contracts: Readonly<Record<string, InputContractDecl>>,
  input: string,
): Set<string> {
  return new Set(
    Object.entries(contracts)
      .filter(([, contract]) => contract.required?.includes(input))
      .map(([path]) => path),
  );
}

export function validateHttpCookiePolicy(facts: WireProjectionFacts, policy: HttpPolicy): void {
  const cookie = policy.cookie;
  if (cookie === undefined) return;
  const routes = facts.routes as Readonly<Record<string, InputContractDecl>>;
  const paths = new Set(Object.keys(routes));
  for (const path of [...cookieIssues(cookie).map(({ path }) => path), ...(cookie.clear ?? [])]) {
    if (!paths.has(path)) throw new Error(`httpPolicy: unknown cookie endpoint path "${path}".`);
  }
  const protectedPaths = cookieProtectedPaths(routes, cookie.input);
  if (protectedPaths.size === 0) {
    throw new Error(`httpPolicy: no endpoint declares cookie input "${cookie.input}".`);
  }
  const wire = facts.logicalWire as unknown as WireContractsIR;
  for (const issue of cookieIssues(cookie)) {
    const issuing = wire.endpoints.find(({ path }) => path === issue.path);
    const fields = issuing === undefined ? undefined : topLevelFields(issuing.output);
    for (const output of [issue.value, issue.expires]) {
      if (!fields?.has(output)) {
        throw new Error(`httpPolicy: issuing endpoint "${issue.path}" has no output "${output}".`);
      }
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

export function projectHttpPolicyWire(
  facts: WireProjectionFacts,
  policy: HttpPolicy,
): WireContractsIR {
  const projected = projectHttpErrors(
    structuredClone(facts.logicalWire) as WireContractsIR,
    policy,
  );
  const cookie = policy.cookie;
  if (cookie === undefined) return projected;
  validateHttpCookiePolicy(facts, policy);
  const routes = facts.routes as Readonly<Record<string, InputContractDecl>>;
  const protectedPaths = cookieProtectedPaths(routes, cookie.input);
  const issuesByPath = new Map(cookieIssues(cookie).map((issue) => [issue.path, issue]));
  return {
    endpoints: projected.endpoints.map((endpoint) => {
      const issue = issuesByPath.get(endpoint.path);
      return {
        ...endpoint,
        input: protectedPaths.has(endpoint.path)
          ? omitTopLevel(endpoint.input, new Set([cookie.input]))
          : endpoint.input,
        output:
          issue === undefined
            ? endpoint.output
            : omitTopLevel(endpoint.output, new Set([issue.value, issue.expires])),
      };
    }),
    appWide: projected.appWide,
  };
}
