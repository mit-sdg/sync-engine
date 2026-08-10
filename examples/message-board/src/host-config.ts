export interface MessageBoardListenerOptions {
  readonly hostname: string;
  readonly port: number;
}

export function validateHostname(value: string, name = "hostname"): string {
  if (value.trim() === "") throw new Error(`${name} must be nonempty.`);
  return value;
}

export function validatePort(value: number, name = "port"): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer from 1 through 65535.`);
  }
  return value;
}

export function validateHttpOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP or HTTPS origin.`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      `${name} must be an absolute HTTP or HTTPS origin without credentials, path, query, or fragment.`,
    );
  }
  return url.origin;
}

export function listenerOptionsFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): MessageBoardListenerOptions {
  const hostname = validateHostname(environment.HOST ?? "localhost", "HOST");
  const rawPort = environment.PORT ?? "3000";
  if (!/^\d+$/.test(rawPort)) {
    throw new Error("PORT must be an integer from 1 through 65535.");
  }
  return { hostname, port: validatePort(Number(rawPort), "PORT") };
}

export function publicOriginFor(hostname: string, port: number): string {
  const publicHostname = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `http://${publicHostname}:${port}`;
}
