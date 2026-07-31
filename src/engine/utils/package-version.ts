import packageManifest from "@root/package.json" with { type: "json" };

export const PACKAGE_NAME = packageManifest.name;
export const PACKAGE_VERSION = packageManifest.version;

export interface GeneratorIdentity {
  name: typeof PACKAGE_NAME;
  version: string;
}

export const GENERATOR_IDENTITY: GeneratorIdentity = Object.freeze({
  name: PACKAGE_NAME,
  version: PACKAGE_VERSION,
});

export function isStableSemVer(value: unknown): value is string {
  return (
    typeof value === "string" && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value)
  );
}

export function assertCurrentGenerator(
  identity: unknown,
  owner: string,
): asserts identity is GeneratorIdentity {
  const candidate = identity as Partial<GeneratorIdentity> | undefined;
  if (
    candidate?.name !== PACKAGE_NAME ||
    !/^1\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(candidate.version ?? "")
  ) {
    throw new Error(`${owner}: requires a stable 1.x ${PACKAGE_NAME} generator identity.`);
  }
}
