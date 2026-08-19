import {
  bindInterface,
  createGateway,
  type EndpointDef,
  type InterfaceDefinition,
} from "@mit-sdg/sync-engine/boundary";
import type { Assembly } from "@mit-sdg/sync-engine/assembly";
import {
  defineFetchRealization,
  fetchClaimMatches,
  type FetchClaim,
  type FetchRealization,
} from "@mit-sdg/sync-engine-http/realization";
import {
  compileHtml,
  diffHtml,
  type FormedHtml,
  type FormedHtmlPatch,
} from "@mit-sdg/sync-engine-rendering/compiled";
import type { RendererInvocation } from "@mit-sdg/sync-engine-rendering/language";

type AnyAssembly = Assembly<Record<string, new (...args: never[]) => object>>;

function scriptData(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function browserRuntime(holder: string, root: string): string {
  return `<script type="module">
const rendering = ${scriptData({ holder, root, sequence: 0 })};
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
        if (!result.ok) {
          const detail = result.error?.detail ?? result.error?.error ?? "The ask was refused.";
          if (refusalSeats.length > 0) {
            for (const seat of refusalSeats) seat.textContent = detail;
          } else {
            const answer = nearestAnswer();
            if (answer) answer.textContent = detail;
          }
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
      if (response.status === 404 || !response.body) return;
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

function documentFor(holder: string, formed: FormedHtml, head: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    head,
    "</head>",
    `<body data-rendered-holder="${holder}"><div data-rendered-root>${formed.content.value}</div>${browserRuntime(holder, formed.holder)}</body>`,
    "</html>",
  ].join("");
}

/** Realize rendered endpoints in one interface as opening HTML documents. */
export function realize(options: {
  system: AnyAssembly;
  interface: InterfaceDefinition;
  head?: WebHead;
}): FetchRealization {
  const selected = bindInterface(options);
  const rendering = compileHtml(selected);
  const reader = {
    async read(read: { concept: string; query: string }, input: Record<string, unknown>) {
      const concept = options.system.concepts[read.concept];
      const query = (concept as Record<string, unknown> | undefined)?.[read.query];
      if (typeof query !== "function") {
        throw new TypeError(`Unknown renderer read ${read.concept}.${read.query}.`);
      }
      return await query.call(concept, input);
    },
  };
  for (const stylesheet of options.head?.stylesheets ?? []) {
    const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.exec(stylesheet.trim());
    if (
      stylesheet.trim().startsWith("//") ||
      (scheme !== null && scheme[0].toLowerCase() !== "https:")
    ) {
      throw new TypeError(
        `Web.realize: head stylesheet ${JSON.stringify(stylesheet)} must be a relative path or an https: URL.`,
      );
    }
  }
  let formedHead: Promise<string> | undefined;
  const headHtml = (): Promise<string> => {
    formedHead ??= (async () => {
      const lines: string[] = [];
      if (options.head?.title !== undefined) {
        lines.push(`<title>${escapeHead(options.head.title)}</title>`);
      }
      for (const stylesheet of options.head?.stylesheets ?? []) {
        lines.push(`<link rel="stylesheet" href="${escapeHead(stylesheet)}">`);
      }
      if (options.head?.styles !== undefined) {
        const styles = await rendering.form(options.head.styles, reader);
        lines.push(styles.content.value);
      }
      return lines.join("");
    })();
    return formedHead;
  };
  const gateway = createGateway({ application: options.system });
  interface HeldRendering {
    readonly invocation: RendererInvocation;
    formed: FormedHtml;
    refreshing: boolean;
    requestedSequence: number;
    processedSequence: number;
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
  const holders = new Map<string, HeldRendering>();
  const encoder = new TextEncoder();
  const endpoints = new Map<string, { path: string; match?: "prefix"; declarations: string[] }>();

  for (const member of selected.members) {
    if (member.kind !== "endpoint") continue;
    const dependencies = selected.dependencies[member.identity] ?? [];
    if (dependencies.length === 0) continue;
    const { path, match } = member.value as EndpointDef;
    const key = `${match ?? "exact"}\0${path}`;
    const endpoint = endpoints.get(key) ?? {
      path,
      ...(match === undefined ? {} : { match }),
      declarations: [],
    };
    endpoint.declarations.push(member.identity);
    endpoints.set(key, endpoint);
  }

  const claims: readonly FetchClaim[] = Object.freeze(
    [...endpoints.values()]
      .sort((left, right) => left.path.localeCompare(right.path))
      .flatMap(({ path, match, declarations }) =>
        (["GET", "POST"] as const).map((method) =>
          Object.freeze({
            method,
            path,
            ...(match === undefined ? {} : { match }),
            declarations: Object.freeze(
              declarations.sort((left, right) => left.localeCompare(right)),
            ),
          }),
        ),
      ),
  );

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

  const message = (change: LiveChange): Uint8Array => encoder.encode(`${JSON.stringify(change)}\n`);

  const send = (held: HeldRendering, change: LiveChange): void => {
    const encoded = message(change);
    for (const stream of held.streams) {
      try {
        stream.enqueue(encoded);
      } catch {
        stream.close();
      }
    }
  };

  options.system.observeSettledChanges((change) => {
    for (const held of holders.values()) {
      const affected = held.formed.reads.some(({ concept }) => change.concepts.includes(concept));
      // A formation can discover a nested read that the previous value did not
      // contain. Conservatively revisit a holder when any change settles while
      // that dependency boundary is moving.
      if (!affected && !held.refreshing) continue;
      held.requestedSequence = change.sequence;
      if (held.refreshing) continue;
      held.refreshing = true;
      void (async () => {
        try {
          while (held.processedSequence < held.requestedSequence) {
            const sequence = held.requestedSequence;
            const previous = held.formed;
            const formed = await rendering.form(held.invocation, reader);
            held.formed = formed;
            const patches = diffHtml(previous, formed);
            if (patches.length > 0) {
              const live = Object.freeze({ sequence, patches });
              held.history.push(live);
              if (held.history.length > 100) {
                held.discardedThrough = held.history.shift()?.sequence ?? held.discardedThrough;
              }
              send(held, live);
            }
            held.processedSequence = sequence;
          }
        } finally {
          held.refreshing = false;
        }
      })().catch(() => undefined);
    }
  });

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
              sequence: held.processedSequence,
              patches: [{ kind: "root", html: held.formed.content.value }],
            }),
          );
        } else {
          const missed = held.history.filter(({ sequence }) => sequence > after);
          if (missed.length === 0) {
            controller.enqueue(message({ sequence: held.processedSequence, patches: [] }));
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

  return defineFetchRealization({
    interface: selected.identity,
    claims,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      if (!claims.some((claim) => fetchClaimMatches(claim, request.method, path)))
        return new Response("Not found", { status: 404 });
      if (request.method === "POST") return answerAsk(request);
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      const followed = url.searchParams.get("__sync_holder");
      if (followed !== null) {
        const parsedAfter = Number(url.searchParams.get("__sync_after") ?? "0");
        const after = Number.isSafeInteger(parsedAfter) && parsedAfter >= 0 ? parsedAfter : 0;
        return follow(followed, after, request.signal);
      }
      const answer = await gateway.invoke(path, {}, { signal: request.signal });
      if (!answer.ok)
        return new Response("The rendered endpoint refused the request.", { status: 500 });
      let formed;
      try {
        formed = await rendering.form(answer.value as RendererInvocation, reader);
      } catch {
        return new Response("The endpoint returned an invalid rendered answer.", { status: 500 });
      }
      const holder = crypto.randomUUID();
      holders.set(holder, {
        invocation: answer.value as RendererInvocation,
        formed,
        refreshing: false,
        requestedSequence: 0,
        processedSequence: 0,
        discardedThrough: 0,
        history: [],
        streams: new Set(),
      });
      if (holders.size > 1_000) {
        const oldest = holders.keys().next().value as string;
        const expired = holders.get(oldest);
        holders.delete(oldest);
        for (const stream of expired?.streams ?? []) stream.close();
      }
      return new Response(documentFor(holder, formed, await headHtml()), {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        },
      });
    },
  });
}
