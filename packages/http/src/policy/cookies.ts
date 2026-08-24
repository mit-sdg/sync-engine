import { assertPortableRoutePath, type WireProjectionFacts } from "@mit-sdg/sync-engine/boundary";
import type { InputContractDecl } from "@mit-sdg/sync-engine/boundary";
import type { WireContractsIR, WireType } from "@mit-sdg/sync-engine/tooling";
import type { HttpCookieBinding, HttpPolicy } from "./types.ts";

const FIELD_NAME = /^[A-Za-z_$][\w$]*$/;
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export interface CookieBindingFacts {
  readonly key: string;
  readonly binding: HttpCookieBinding & {
    readonly sameSite: "Strict" | "Lax" | "None";
    readonly path: string;
  };
  readonly cookieName: string;
  readonly issuePaths: ReadonlySet<string>;
  readonly clearPaths: ReadonlySet<string>;
}

function own<T extends object>(target: T, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: false,
    enumerable: true,
    value,
    writable: false,
  });
}

function cookieName(binding: HttpCookieBinding, path: string): string {
  if (binding.name.startsWith("__Host-") && (binding.domain !== undefined || path !== "/")) {
    throw new Error(
      `httpPolicy: cookie "${binding.name}" uses the __Host- prefix with an incompatible domain or path.`,
    );
  }
  if (binding.name.startsWith("__Host-") || binding.name.startsWith("__Secure-")) {
    return binding.name;
  }
  return binding.domain === undefined && path === "/"
    ? `__Host-${binding.name}`
    : `__Secure-${binding.name}`;
}

export function normalizeCookies(
  cookies: Readonly<Record<string, HttpCookieBinding>> | undefined,
  browserDeclared: boolean,
): Readonly<Record<string, HttpCookieBinding>> | undefined {
  if (cookies === undefined) return undefined;
  const normalized: Record<string, HttpCookieBinding> = {};
  const names = new Set<string>();
  const inputs = new Set<string>();
  for (const [key, binding] of Object.entries(cookies)) {
    if (key === "") throw new Error("httpPolicy: cookie binding names must be non-empty.");
    for (const [field, value] of [
      ["name", binding.name],
      ["input", binding.input],
      ...binding.issue.flatMap((issue) => [
        ["value", issue.value] as const,
        ["expires", issue.expires] as const,
      ]),
    ] as const) {
      const valid = field === "name" ? COOKIE_NAME.test(value) : FIELD_NAME.test(value);
      if (!valid) throw new Error(`httpPolicy: cookie "${key}" field ${field} is invalid.`);
    }
    if (binding.issue.length === 0) {
      throw new Error(`httpPolicy: cookie "${key}" must declare at least one issue endpoint.`);
    }
    const path = binding.path ?? "/";
    assertPortableRoutePath(path, `httpPolicy: cookie "${key}" path`);
    if (path.includes(";")) {
      throw new Error(`httpPolicy: cookie "${key}" field path must not contain ';'.`);
    }
    if (binding.domain !== undefined) {
      if (
        binding.domain === "" ||
        binding.domain.startsWith(".") ||
        !/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?))*$/.test(
          binding.domain,
        )
      ) {
        throw new Error(`httpPolicy: cookie "${key}" field domain is invalid.`);
      }
    }
    if (
      binding.sameSite !== undefined &&
      !(["Strict", "Lax", "None"] as const).includes(binding.sameSite)
    ) {
      throw new Error(`httpPolicy: cookie "${key}" field sameSite is invalid.`);
    }
    if (binding.sameSite !== undefined && !browserDeclared) {
      throw new Error(`httpPolicy: cookie "${key}" field sameSite requires a browser policy.`);
    }
    const sameSite = binding.sameSite ?? (browserDeclared ? "None" : "Strict");
    const issue = binding.issue.map((item) => {
      assertPortableRoutePath(item.path, `httpPolicy: cookie "${key}" issue endpoint`);
      if (item.value === item.expires) {
        throw new Error(
          `httpPolicy: cookie "${key}" issue endpoint "${item.path}" must use distinct value and expires fields.`,
        );
      }
      return Object.freeze({ ...item });
    });
    const clear = binding.clear.map((item) => {
      assertPortableRoutePath(item, `httpPolicy: cookie "${key}" clear endpoint`);
      return item;
    });
    const issuePaths = issue.map(({ path: item }) => item);
    if (new Set(issuePaths).size !== issuePaths.length) {
      throw new Error(`httpPolicy: cookie "${key}" issue endpoints must be distinct.`);
    }
    if (new Set(clear).size !== clear.length) {
      throw new Error(`httpPolicy: cookie "${key}" clear endpoints must be distinct.`);
    }
    const conflict = issuePaths.find((item) => clear.includes(item));
    if (conflict !== undefined) {
      throw new Error(`httpPolicy: cookie "${key}" endpoint "${conflict}" cannot issue and clear.`);
    }
    const effectiveName = cookieName(binding, path);
    if (names.has(effectiveName)) {
      throw new Error(`httpPolicy: duplicate cookie name "${effectiveName}".`);
    }
    if (inputs.has(binding.input)) {
      throw new Error(`httpPolicy: duplicate cookie input "${binding.input}".`);
    }
    names.add(effectiveName);
    inputs.add(binding.input);
    own(
      normalized,
      key,
      Object.freeze({
        ...binding,
        issue: Object.freeze(issue),
        clear: Object.freeze(clear),
        sameSite,
        path,
      }),
    );
  }
  return Object.freeze(normalized);
}

function cookieBindingFacts(policy: HttpPolicy): readonly CookieBindingFacts[] {
  return Object.freeze(
    Object.entries(policy.cookies ?? {}).map(([key, source]) => {
      const binding = source as CookieBindingFacts["binding"];
      return Object.freeze({
        key,
        binding,
        cookieName: cookieName(binding, binding.path),
        issuePaths: new Set(binding.issue.map(({ path }) => path)),
        clearPaths: new Set(binding.clear),
      });
    }),
  );
}

function topLevelFields(type: WireType | undefined, common: boolean): Set<string> | undefined {
  if (type === undefined) return undefined;
  if (type.kind === "object") return new Set(type.fields.map((field) => field.key));
  if (type.kind !== "union") return undefined;
  const alternatives = type.of.map((item) => topLevelFields(item, common));
  if (common) {
    if (alternatives.some((fields) => fields === undefined)) return undefined;
    const fields = new Set(alternatives[0]);
    for (const alternative of alternatives.slice(1)) {
      for (const key of fields) if (!alternative?.has(key)) fields.delete(key);
    }
    return fields;
  }
  const fields = new Set<string>();
  for (const alternative of alternatives) {
    for (const key of alternative ?? []) fields.add(key);
  }
  return fields;
}

function protectedPaths(
  routes: Readonly<Record<string, InputContractDecl>>,
  input: string,
): Set<string> {
  return new Set(
    Object.entries(routes)
      .filter(([, contract]) => contract.required?.includes(input) === true)
      .map(([path]) => path),
  );
}

export interface ValidatedCookieBinding extends CookieBindingFacts {
  readonly protectedPaths: ReadonlySet<string>;
  readonly touchedPaths: ReadonlySet<string>;
}

export function validateCookieBindings(
  facts: WireProjectionFacts,
  policy: HttpPolicy,
): readonly ValidatedCookieBinding[] {
  const routes = facts.routes as Readonly<Record<string, InputContractDecl>>;
  const wire = facts.logicalWire as unknown as WireContractsIR;
  const endpoints = new Map(wire.endpoints.map((endpoint) => [endpoint.path, endpoint]));
  const knownPaths = new Set([...Object.keys(routes), ...endpoints.keys()]);
  const owners = new Map<string, string>();
  const validated = Object.freeze(
    cookieBindingFacts(policy).map((factsForBinding) => {
      const { binding, key } = factsForBinding;
      for (const path of [...factsForBinding.issuePaths, ...factsForBinding.clearPaths]) {
        if (!knownPaths.has(path)) {
          throw new Error(`httpPolicy: cookie "${key}" names unknown endpoint "${path}".`);
        }
      }
      const protectedForBinding = protectedPaths(routes, binding.input);
      if (protectedForBinding.size === 0) {
        throw new Error(
          `httpPolicy: cookie "${key}" input "${binding.input}" is not required by any endpoint.`,
        );
      }
      for (const [path, endpoint] of endpoints) {
        const mentions = topLevelFields(endpoint.input, false)?.has(binding.input) === true;
        if (mentions && !protectedForBinding.has(path)) {
          throw new Error(
            `httpPolicy: endpoint "${path}" mentions cookie "${key}" input "${binding.input}" without requiring it.`,
          );
        }
      }
      for (const path of protectedForBinding) {
        const owner = owners.get(path);
        if (owner !== undefined) {
          throw new Error(
            `httpPolicy: endpoint "${path}" is protected by cookies "${owner}" and "${key}".`,
          );
        }
        owners.set(path, key);
      }
      for (const issue of binding.issue) {
        const fields = topLevelFields(endpoints.get(issue.path)?.output, true);
        for (const field of [issue.value, issue.expires]) {
          if (!fields?.has(field)) {
            throw new Error(
              `httpPolicy: cookie "${key}" issue endpoint "${issue.path}" has no output "${field}".`,
            );
          }
        }
      }
      return Object.freeze({
        ...factsForBinding,
        protectedPaths: protectedForBinding,
        touchedPaths: new Set([
          ...protectedForBinding,
          ...factsForBinding.issuePaths,
          ...factsForBinding.clearPaths,
        ]),
      });
    }),
  );
  const guarded = policy.direct?.find((route) =>
    validated.some((binding) => binding.touchedPaths.has(route.endpoint)),
  );
  if (guarded !== undefined) {
    throw new Error(
      `httpPolicy: direct route ${guarded.path} serves cookie-bound endpoint ${guarded.endpoint}; a direct route carries no cookies.`,
    );
  }
  return validated;
}

export function omitTopLevel(type: WireType, omitted: ReadonlySet<string>): WireType {
  if (type.kind === "object") {
    return { ...type, fields: type.fields.filter((field) => !omitted.has(field.key)) };
  }
  if (type.kind === "union") {
    return { ...type, of: type.of.map((item) => omitTopLevel(item, omitted)) };
  }
  return type;
}
