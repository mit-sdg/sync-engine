import {
  bindInterface,
  createGateway,
  type EndpointDef,
  type InterfaceDefinition,
} from "@mit-sdg/sync-engine/boundary";
import type { Assembly } from "@mit-sdg/sync-engine/assembly";
import {
  defineLiveFetchRealization,
  fetchClaimMatches,
  type FetchClaim,
  type FetchRealization,
} from "@mit-sdg/sync-engine-http/realization";
import {
  compileHtml,
  diffHtml,
  type CompiledHtmlRendering,
  type FormedHtml,
  type FormedHtmlPatch,
} from "@mit-sdg/sync-engine-rendering/compiled";
import type { RendererInvocation } from "@mit-sdg/sync-engine-rendering/language";
import type { WebCandidate } from "./candidate.ts";
import { interfaceRevision } from "./revision.ts";

type AnyAssembly = Assembly<Record<string, new (...args: never[]) => object>>;

function scriptData(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function browserRuntime(holder: string, root: string, immediateSource: string): string {
  return `<script type="module">
const rendering = ${scriptData({ holder, root, sequence: 0 })};
const immediates = {
${immediateSource}
};
const storageKey = (address) => "sync-engine:" + rendering.root + ":" + address;
const field = (address) => document.querySelector('[data-rendered-seat="' + CSS.escape(address) + '"]');
const arm = () => {
  for (const element of document.querySelectorAll("[data-rendered-field]")) {
    if (element.dataset.renderedArmed) continue;
    element.dataset.renderedArmed = "true";
    const address = element.dataset.renderedSeat;
    const retained = localStorage.getItem(storageKey(address));
    if (retained !== null) element.value = retained;
    element.addEventListener("input", () => localStorage.setItem(storageKey(address), element.value));
  }
  for (const element of document.querySelectorAll("[data-rendered-ask]")) {
    if (element.dataset.renderedArmed) continue;
    element.dataset.renderedArmed = "true";
    const form = element.form ?? element.closest("form");
    if (form && !form.dataset.renderedArmed) {
      form.dataset.renderedArmed = "true";
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const submitter =
          event.submitter && event.submitter.dataset.renderedAsk
            ? event.submitter
            : form.querySelector("[data-rendered-ask]");
        submitter?.click();
      });
    }
    element.addEventListener("click", async (event) => {
      event.preventDefault();
      if (element.getAttribute("aria-busy") === "true") return;
      element.setAttribute("aria-busy", "true");
      try {
        const values = {};
        for (const address of (element.dataset.renderedAskFields ?? "").split(" ")) {
          if (address === "") continue;
          const held = field(address);
          if (held) values[address] = held.value;
        }
        const response = await fetch(location.href, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ holder: rendering.holder, ask: element.dataset.renderedAsk, fields: values }),
        });
        const result = await response.json();
        const refusalSeats = (element.dataset.renderedAskRefuses ?? "")
          .split(" ")
          .filter((address) => address !== "")
          .map((address) => document.querySelector('[data-rendered-refusal="' + CSS.escape(address) + '"]'))
          .filter((seat) => seat !== null);
        const nearestAnswer = () => {
          for (let scope = element.parentElement; scope; scope = scope.parentElement) {
            const answer = scope.querySelector("[data-rendered-answer]");
            if (answer) return answer;
          }
          return null;
        };
        const runImmediate = (attribute) => {
          const raw = element.getAttribute(attribute);
          if (!raw) return;
          try {
            const spec = JSON.parse(raw);
            const implementation = immediates[spec.immediate];
            if (!implementation) return;
            const resolved = { element };
            for (const [name, value] of Object.entries(spec.args ?? {})) {
              resolved[name] = Array.isArray(value) ? value.map(field).filter(Boolean) : field(value);
            }
            implementation(resolved);
            for (const value of Object.values(spec.args ?? {})) {
              for (const address of Array.isArray(value) ? value : [value]) {
                const held = field(address);
                if (held) localStorage.setItem(storageKey(address), held.value);
              }
            }
          } catch {}
        };
        if (!result.ok) {
          const detail = result.error?.detail ?? result.error?.error ?? "The ask was refused.";
          if (refusalSeats.length > 0) {
            for (const seat of refusalSeats) seat.textContent = detail;
          } else {
            const answer = nearestAnswer();
            if (answer) answer.textContent = detail;
          }
          runImmediate("data-rendered-on-refused");
          return;
        }
        for (const seat of refusalSeats) seat.textContent = "";
        for (const [address, value] of Object.entries(result.seats ?? {})) {
          const held = field(address);
          if (held) held.value = String(value);
          localStorage.setItem(storageKey(address), String(value));
        }
        if (refusalSeats.length === 0) {
          const answer = nearestAnswer();
          if (answer) answer.textContent = "Accepted.";
        }
        runImmediate("data-rendered-on-accepted");
      } finally {
        element.removeAttribute("aria-busy");
      }
    });
  }
};
arm();
const renderedRoot = () => document.querySelector("[data-rendered-root]");
const boundary = (edge, address) => {
  const root = renderedRoot();
  if (!root) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const wanted = "sync:" + edge + ":" + address;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.data === wanted) return node;
  }
  return null;
};
const fragmentBefore = (anchor, html) => {
  const range = document.createRange();
  range.setStartBefore(anchor);
  range.setEndBefore(anchor);
  return range.createContextualFragment(html);
};
const replaceInside = (address, html) => {
  const start = boundary("start", address);
  const end = boundary("end", address);
  if (!start || !end) throw new Error("Unknown rendered address " + address);
  const range = document.createRange();
  range.setStartAfter(start);
  range.setEndBefore(end);
  range.deleteContents();
  end.parentNode.insertBefore(fragmentBefore(end, html), end);
};
const removeRange = (address) => {
  const start = boundary("start", address);
  const end = boundary("end", address);
  if (!start || !end) return;
  const range = document.createRange();
  range.setStartBefore(start);
  range.setEndAfter(end);
  range.deleteContents();
};
const moveBefore = (address, anchor) => {
  const start = boundary("start", address);
  const end = boundary("end", address);
  if (!start || !end || end.nextSibling === anchor) return;
  const range = document.createRange();
  range.setStartBefore(start);
  range.setEndAfter(end);
  anchor.parentNode.insertBefore(range.extractContents(), anchor);
};
const apply = (patch) => {
  const root = renderedRoot();
  if (!root) return;
  if (patch.kind === "root") {
    root.innerHTML = patch.html;
  } else if (patch.kind === "show") {
    replaceInside(patch.address, "");
    const end = boundary("end", patch.address);
    end.parentNode.insertBefore(document.createTextNode(patch.value), end);
  } else if (patch.kind === "attr") {
    const element = root.querySelector('[data-rendered-attrs="' + CSS.escape(patch.element) + '"]');
    if (!element) return;
    if (patch.value === null) element.removeAttribute(patch.name);
    else element.setAttribute(patch.name, patch.value);
  } else if (patch.kind === "clause") {
    replaceInside(patch.address, patch.html);
  } else if (patch.kind === "rows") {
    for (const address of patch.left) removeRange(address);
    const clauseEnd = boundary("end", patch.address);
    if (!clauseEnd) throw new Error("Unknown rendered clause " + patch.address);
    for (const row of patch.entered) {
      clauseEnd.parentNode.insertBefore(fragmentBefore(clauseEnd, row.html), clauseEnd);
    }
    let anchor = clauseEnd;
    for (const address of [...patch.order].reverse()) {
      moveBefore(address, anchor);
      anchor = boundary("start", address);
    }
  }
};
const follow = async () => {
  const url = new URL(location.href);
  url.searchParams.set("__sync_holder", rendering.holder);
  while (true) {
    try {
      url.searchParams.set("__sync_after", String(rendering.sequence));
      const response = await fetch(url, { headers: { accept: "application/x-ndjson" } });
      if (response.status === 404 || !response.body) {
        renderedRoot()?.setAttribute("data-rendered-gone", "");
        return;
      }
      if (!response.ok) throw new Error("Live refill refused");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffered += decoder.decode(next.value, { stream: true });
        const lines = buffered.split("\\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const change = JSON.parse(line);
          for (const patch of change.patches ?? []) apply(patch);
          rendering.sequence = change.sequence;
          arm();
        }
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
};
void follow();
</script>`;
}

/** Authored head material shared by every page of one realization. */
export interface WebHead {
  readonly title?: string;
  /** External stylesheet links; each must be a relative path or an https: URL. */
  readonly stylesheets?: readonly string[];
  /** One admitted styles renderer whose formed content lands in the head. */
  readonly styles?: RendererInvocation;
}

function escapeHead(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function documentFor(
  holder: string,
  formed: FormedHtml,
  head: string,
  immediateSource: string,
): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    head,
    "</head>",
    `<body data-rendered-holder="${holder}"><div data-rendered-root>${formed.content.value}</div>${browserRuntime(holder, formed.holder, immediateSource)}</body>`,
    "</html>",
  ].join("");
}

/** Realization-bound implementations for declared immediates, by canonical identity. */
export type ImmediateBindings = Record<string, (args: never) => unknown>;

/** How declared reads resolve against the assembled system's queries. */
export interface RenderedReader {
  read(read: { concept: string; query: string }, input: Record<string, unknown>): Promise<unknown>;
}

export function readerFor(system: AnyAssembly): RenderedReader {
  return {
    async read(read: { concept: string; query: string }, input: Record<string, unknown>) {
      const concept = system.concepts[read.concept];
      const query = (concept as Record<string, unknown> | undefined)?.[read.query];
      if (typeof query !== "function") {
        throw new TypeError(`Unknown renderer read ${read.concept}.${read.query}.`);
      }
      return await query.call(concept, input);
    },
  };
}

/** Form the shared document head once: title, checked stylesheet links, formed styles. */
export function headHtmlFor(
  head: WebHead | undefined,
  rendering: CompiledHtmlRendering,
  reader: RenderedReader,
): () => Promise<string> {
  let formedHead: Promise<string> | undefined;
  return () => {
    formedHead ??= (async () => {
      const lines: string[] = [];
      if (head?.title !== undefined) {
        lines.push(`<title>${escapeHead(head.title)}</title>`);
      }
      for (const stylesheet of head?.stylesheets ?? []) {
        lines.push(`<link rel="stylesheet" href="${escapeHead(stylesheet)}">`);
      }
      if (head?.styles !== undefined) {
        const styles = await rendering.form(head.styles, reader);
        lines.push(styles.content.value);
      }
      return lines.join("");
    })();
    return formedHead;
  };
}

export function assertHeadStylesheets(site: string, head: WebHead | undefined): void {
  for (const stylesheet of head?.stylesheets ?? []) {
    const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.exec(stylesheet.trim());
    if (
      stylesheet.trim().startsWith("//") ||
      (scheme !== null && scheme[0].toLowerCase() !== "https:")
    ) {
      throw new TypeError(
        `${site}: head stylesheet ${JSON.stringify(stylesheet)} must be a relative path or an https: URL.`,
      );
    }
  }
}

export function assertImmediatesBound(
  site: string,
  rendering: CompiledHtmlRendering,
  immediates: ImmediateBindings | undefined,
): string {
  for (const identity of rendering.immediates) {
    if (typeof immediates?.[identity] !== "function") {
      throw new TypeError(
        `${site}: immediate ${JSON.stringify(identity)} has no bound implementation; ` +
          "pass it in the immediates option.",
      );
    }
  }
  return Object.entries(immediates ?? {})
    .map(
      ([identity, binding]) =>
        `${JSON.stringify(identity)}: ${String(binding).replaceAll("</script", "<\\/script")}`,
    )
    .join(",\n");
}

/**
 * One servable interface surface: the compiled rendering, the served claim
 * set, and per-path opening. The accepted realization holds exactly one and
 * promotion replaces it whole.
 */
export interface RenderedSurface {
  readonly interface: string;
  readonly rendering: CompiledHtmlRendering;
  readonly claims: readonly FetchClaim[];
  /** Resolve one served GET path to its root renderer invocation. */
  open(path: string, request: Request): Promise<RendererInvocation | undefined>;
  headHtml(): Promise<string>;
  readonly immediateSource: string;
  revision(): Promise<string>;
}

export function claimsForEndpoints(
  endpoints: readonly { readonly path: string; readonly match?: "prefix" }[],
  servedPath: (path: string) => string,
): readonly FetchClaim[] {
  const byKey = new Map<string, { path: string; match?: "prefix" }>();
  for (const endpoint of endpoints) {
    const key = `${endpoint.match ?? "exact"}\0${endpoint.path}`;
    byKey.set(key, {
      path: servedPath(endpoint.path),
      ...(endpoint.match === undefined ? {} : { match: endpoint.match }),
    });
  }
  return Object.freeze(
    [...byKey.values()]
      .sort((left, right) => left.path.localeCompare(right.path))
      .flatMap(({ path, match }) =>
        (["GET", "POST"] as const).map((method) =>
          Object.freeze({
            method,
            path,
            ...(match === undefined ? {} : { match }),
            declarations: Object.freeze([] as string[]),
          }),
        ),
      ),
  );
}

export interface WebRealization extends FetchRealization {
  /** The canonical content revision of the surface currently served. */
  revision(): Promise<string>;
  /**
   * Make an assembled candidate what the accepted claims serve, atomically
   * for new opens; holders already open receive one root repair formed under
   * the new declarations, and a holder whose endpoint the new surface no
   * longer declares is closed.
   */
  promote(candidate: WebCandidate): Promise<void>;
  /** Close every holder and detach from settled-change observation. */
  close(): void;
}

interface HeldRendering {
  readonly key: string;
  invocation: RendererInvocation;
  readonly path: string;
  formed: FormedHtml;
  rendering: CompiledHtmlRendering;
  refreshing: Promise<void> | undefined;
  reopen: boolean;
  gone: boolean;
  requestedSequence: number;
  processedSequence: number;
  emitted: number;
  discardedThrough: number;
  readonly history: LiveChange[];
  readonly streams: Set<HeldStream>;
}

interface LiveChange {
  readonly sequence: number;
  readonly patches: readonly FormedHtmlPatch[];
}

interface HeldStream {
  enqueue(value: Uint8Array): void;
  close(): void;
}

/** The shared holder machinery behind the accepted realization and candidate previews. */
export function renderedRealization(options: {
  system: AnyAssembly;
  surface: RenderedSurface;
  onPromote?: (candidate: WebCandidate) => RenderedSurface;
}): WebRealization {
  const reader = readerFor(options.system);
  let current = options.surface;
  const holders = new Map<string, HeldRendering>();
  const encoder = new TextEncoder();

  const message = (change: LiveChange): Uint8Array => encoder.encode(`${JSON.stringify(change)}\n`);

  const send = (held: HeldRendering, change: LiveChange): void => {
    held.history.push(change);
    if (held.history.length > 100) {
      held.discardedThrough = held.history.shift()?.sequence ?? held.discardedThrough;
    }
    const encoded = message(change);
    for (const stream of held.streams) {
      try {
        stream.enqueue(encoded);
      } catch {
        stream.close();
      }
    }
  };

  const closeHolder = (holder: string): void => {
    const held = holders.get(holder);
    if (held === undefined) return;
    held.gone = true;
    holders.delete(holder);
    for (const stream of Array.from(held.streams)) stream.close();
  };

  const refresh = (held: HeldRendering): Promise<void> => {
    if (held.refreshing !== undefined) return held.refreshing;
    held.refreshing = (async () => {
      try {
        while (held.processedSequence < held.requestedSequence || held.reopen) {
          const sequence = held.requestedSequence;
          if (held.reopen) {
            held.reopen = false;
            const invocation = await current.open(held.path, new Request("http://sync.internal/"));
            if (invocation === undefined) {
              closeHolder(held.key);
              return;
            }
            held.invocation = invocation;
            held.rendering = current.rendering;
            held.formed = await current.rendering.form(invocation, reader);
            send(held, {
              sequence: ++held.emitted,
              patches: [{ kind: "root", html: held.formed.content.value }],
            });
            held.processedSequence = Math.max(held.processedSequence, sequence);
            continue;
          }
          const previous = held.formed;
          const formed = await held.rendering.form(held.invocation, reader);
          held.formed = formed;
          const patches = diffHtml(previous, formed);
          if (patches.length > 0) {
            send(held, Object.freeze({ sequence: ++held.emitted, patches }));
          }
          held.processedSequence = sequence;
        }
      } finally {
        held.refreshing = undefined;
      }
    })().catch(() => undefined) as Promise<void>;
    return held.refreshing;
  };

  const unobserve = options.system.observeSettledChanges((change) => {
    for (const held of holders.values()) {
      const affected = held.formed.reads.some(({ concept }) => change.concepts.includes(concept));
      // A formation can discover a nested read that the previous value did not
      // contain. Conservatively revisit a holder when any change settles while
      // that dependency boundary is moving.
      if (!affected && !held.refreshing) continue;
      held.requestedSequence = change.sequence;
      void refresh(held);
    }
  });

  const answerAsk = async (request: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ ok: false, error: { error: "INVALID_ASK" } }, { status: 400 });
    }
    if (typeof body !== "object" || body === null) {
      return Response.json({ ok: false, error: { error: "INVALID_ASK" } }, { status: 400 });
    }
    const asked = body as { holder?: unknown; ask?: unknown; fields?: unknown };
    if (
      typeof asked.holder !== "string" ||
      typeof asked.ask !== "string" ||
      typeof asked.fields !== "object" ||
      asked.fields === null
    ) {
      return Response.json({ ok: false, error: { error: "INVALID_ASK" } }, { status: 400 });
    }
    const held = holders.get(asked.holder);
    const ask = held?.formed.asks.find((candidate) => candidate.id === asked.ask);
    if (ask === undefined) {
      return Response.json({ ok: false, error: { error: "UNKNOWN_ASK" } }, { status: 404 });
    }
    const supplied = asked.fields as Record<string, unknown>;
    const input = Object.fromEntries(
      Object.entries(ask.input).map(([name, source]) => [
        name,
        source.source === "field"
          ? (supplied[source.address] ?? supplied[source.name] ?? "")
          : source.value,
      ]),
    );
    const concept = options.system.concepts[ask.concept];
    const action = (concept as Record<string, unknown> | undefined)?.[ask.action];
    if (typeof action !== "function") {
      return Response.json({ ok: false, error: { error: "UNKNOWN_ACTION" } }, { status: 500 });
    }
    try {
      const result = await action.call(concept, input);
      if (
        typeof result === "object" &&
        result !== null &&
        typeof (result as { error?: unknown }).error === "string"
      ) {
        return Response.json({ ok: false, error: result }, { status: 422 });
      }
      const record =
        typeof result === "object" && result !== null
          ? (result as Record<string, unknown>)
          : ({} as Record<string, unknown>);
      const fields = Object.fromEntries(
        Object.entries(ask.output).map(([name, field]) => [field.name, record[name]]),
      );
      const seats = Object.fromEntries(
        Object.entries(ask.output).map(([name, field]) => [field.address, record[name]]),
      );
      return Response.json({ ok: true, value: result, fields, seats });
    } catch {
      return Response.json({ ok: false, error: { error: "ASK_FAILED" } }, { status: 500 });
    }
  };

  const follow = (holder: string, after: number, signal: AbortSignal): Response => {
    const held = holders.get(holder);
    if (held === undefined) return new Response("Unknown rendered holder", { status: 404 });
    let heldStream: HeldStream | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const remove = () => {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      heartbeat = undefined;
      if (heldStream !== undefined) held.streams.delete(heldStream);
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        heldStream = {
          enqueue: (value) => {
            if (controller.desiredSize !== null && controller.desiredSize <= 0) {
              heldStream?.close();
              return;
            }
            controller.enqueue(value);
          },
          close: () => {
            remove();
            try {
              controller.close();
            } catch {
              // The consumer may already have cancelled the stream.
            }
          },
        };
        held.streams.add(heldStream);
        if (after < held.discardedThrough) {
          controller.enqueue(
            message({
              sequence: held.emitted,
              patches: [{ kind: "root", html: held.formed.content.value }],
            }),
          );
        } else {
          const missed = held.history.filter(({ sequence }) => sequence > after);
          if (missed.length === 0) {
            controller.enqueue(message({ sequence: held.emitted, patches: [] }));
          } else {
            for (const change of missed) controller.enqueue(message(change));
          }
        }
        heartbeat = setInterval(() => {
          try {
            heldStream?.enqueue(encoder.encode("\n"));
          } catch {
            heldStream?.close();
          }
        }, 5_000);
      },
      cancel() {
        remove();
      },
    });
    signal.addEventListener(
      "abort",
      () => {
        heldStream?.close();
      },
      { once: true },
    );
    return new Response(body, {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/x-ndjson; charset=utf-8",
      },
    });
  };

  let closed = false;

  const web: WebRealization = defineLiveFetchRealization({
    interface: current.interface,
    claims: () => current.claims,
    revision: () => current.revision(),
    promote: async (candidate: WebCandidate): Promise<void> => {
      if (options.onPromote === undefined) {
        throw new TypeError("Web.promote: this realization does not accept promotion.");
      }
      if (candidate.system !== options.system) {
        throw new TypeError(
          "Web.promote: the candidate was assembled against another system; " +
            "assemble it against the system this realization serves.",
        );
      }
      current = options.onPromote(candidate);
      const repairs: Promise<void>[] = [];
      for (const [holder, held] of Array.from(holders.entries())) {
        if (!current.claims.some((claim) => fetchClaimMatches(claim, "GET", held.path))) {
          closeHolder(holder);
          continue;
        }
        held.reopen = true;
        repairs.push(refresh(held));
      }
      await Promise.all(repairs);
    },
    close: (): void => {
      closed = true;
      unobserve();
      for (const holder of Array.from(holders.keys())) closeHolder(holder);
    },
    async fetch(request: Request): Promise<Response> {
      if (closed) return new Response("Gone", { status: 410 });
      const url = new URL(request.url);
      const path = url.pathname;
      if (!current.claims.some((claim) => fetchClaimMatches(claim, request.method, path)))
        return new Response("Not found", { status: 404 });
      if (request.method === "POST") return answerAsk(request);
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      const followed = url.searchParams.get("__sync_holder");
      if (followed !== null) {
        const parsedAfter = Number(url.searchParams.get("__sync_after") ?? "0");
        const after = Number.isSafeInteger(parsedAfter) && parsedAfter >= 0 ? parsedAfter : 0;
        return follow(followed, after, request.signal);
      }
      let formed: FormedHtml;
      let invocation: RendererInvocation | undefined;
      const opened = current;
      try {
        invocation = await opened.open(path, request);
      } catch {
        return new Response("The rendered endpoint refused the request.", { status: 500 });
      }
      if (invocation === undefined) {
        return new Response("The rendered endpoint refused the request.", { status: 500 });
      }
      try {
        formed = await opened.rendering.form(invocation, reader);
      } catch {
        return new Response("The endpoint returned an invalid rendered answer.", { status: 500 });
      }
      const holder = crypto.randomUUID();
      holders.set(holder, {
        key: holder,
        invocation,
        path,
        formed,
        rendering: opened.rendering,
        refreshing: undefined,
        reopen: false,
        gone: false,
        requestedSequence: 0,
        processedSequence: 0,
        emitted: 0,
        discardedThrough: 0,
        history: [],
        streams: new Set(),
      });
      if (holders.size > 1_000) {
        const oldest = holders.keys().next().value as string;
        closeHolder(oldest);
      }
      return new Response(
        documentFor(holder, formed, await opened.headHtml(), opened.immediateSource),
        {
          status: 200,
          headers: {
            "cache-control": "no-store",
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    },
  });
  return web;
}

/** Realize rendered endpoints in one interface as opening HTML documents. */
export function realize(options: {
  system: AnyAssembly;
  interface: InterfaceDefinition;
  head?: WebHead;
  immediates?: ImmediateBindings;
}): WebRealization {
  const selected = bindInterface(options);
  const rendering = compileHtml(selected);
  const immediateSource = assertImmediatesBound("Web.realize", rendering, options.immediates);
  assertHeadStylesheets("Web.realize", options.head);
  const reader = readerFor(options.system);
  const gateway = createGateway({ application: options.system });

  const endpointDefs: { path: string; match?: "prefix" }[] = [];
  for (const member of selected.members) {
    if (member.kind !== "endpoint") continue;
    const dependencies = selected.dependencies[member.identity] ?? [];
    if (dependencies.length === 0) continue;
    const { path, match } = member.value as EndpointDef;
    endpointDefs.push({ path, ...(match === undefined ? {} : { match }) });
  }

  let revision: Promise<string> | undefined;
  const surface: RenderedSurface = {
    interface: selected.identity,
    rendering,
    claims: claimsForEndpoints(endpointDefs, (path) => path),
    async open(path, request) {
      const answer = await gateway.invoke(path, {}, { signal: request.signal });
      if (!answer.ok) return undefined;
      return answer.value as RendererInvocation;
    },
    headHtml: headHtmlFor(options.head, rendering, reader),
    immediateSource,
    revision: () => {
      revision ??= interfaceRevision(selected);
      return revision;
    },
  };

  return renderedRealization({
    system: options.system,
    surface,
    onPromote: (candidate) => candidate.promotedSurface(),
  });
}
