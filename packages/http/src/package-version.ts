import packageManifest from "../package.json" with { type: "json" };

export const HTTP_PACKAGE_NAME = packageManifest.name;
export const HTTP_PACKAGE_VERSION = packageManifest.version;
