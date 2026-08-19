import {
  evaluateEndpoint,
  type EndpointDef,
  type InterfaceBinding,
} from "@mit-sdg/sync-engine/boundary";

function canonicalRevisionValue(value: unknown, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalRevisionValue(entry, `${path}[${index}]`));
  }
  if (typeof value !== "object") {
    throw new TypeError(`interfaceRevision: ${path} holds a non-portable ${typeof value} value.`);
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, canonicalRevisionValue(record[key], `${path}.${key}`)]),
  );
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function declaredForm(value: unknown): unknown {
  const declaration = (value as { declaration?: unknown }).declaration;
  return declaration ?? null;
}

/**
 * The canonical content revision of one bound interface: a hash over the
 * lowered declarations of its members and their reachable dependencies, with
 * each rendered endpoint contributing its route and exact root invocation.
 * Two interfaces with the same canonical content share a revision regardless
 * of the modules that carried them.
 */
export async function interfaceRevision(binding: InterfaceBinding): Promise<string> {
  const members = [...binding.members]
    .sort((left, right) => left.identity.localeCompare(right.identity))
    .map((member) => {
      if (member.kind === "endpoint") {
        const evaluated = evaluateEndpoint(member.identity, member.value as EndpointDef);
        return {
          identity: member.identity,
          kind: "endpoint",
          path: evaluated.path,
          match: evaluated.match ?? null,
          root: evaluated.root ?? null,
          rootRefusal: evaluated.rootRefusal ?? null,
        };
      }
      return {
        identity: member.identity,
        kind: "declaration",
        declared: declaredForm(member.value),
      };
    });
  const dependencies = Object.fromEntries(
    Object.entries(binding.dependencies)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([member, declarations]) => [
        member,
        declarations.map((declaration) => ({
          identity: declaration.identity,
          declared: declaredForm(declaration.value),
        })),
      ]),
  );
  const subject = canonicalRevisionValue(
    {
      format: "sync-engine.web-interface",
      version: 1,
      interface: binding.identity,
      members,
      dependencies,
    },
    "interface",
  );
  return sha256Hex(JSON.stringify(subject));
}
