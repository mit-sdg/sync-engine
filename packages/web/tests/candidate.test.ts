import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
import { defineInterface, endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, html, renderer } from "@mit-sdg/sync-engine-rendering/language";
import { expect, test } from "vite-plus/test";
import { applySelection, assembleCandidate, realize } from "../src/realization/index.ts";

class NotingConcept {
  readonly #notes: string[] = [];

  note({ text }: { text: string }): { note: string } {
    this.#notes.push(text);
    return { note: text };
  }

  _all(_input: Record<string, never>): Array<{ note: string; text: string }> {
    return this.#notes.map((text, index) => ({ note: `note-${index}`, text }));
  }
}

const notingSpec = `# Noting

## Purpose

Keep the notes people record so they can be read back in order.

## Principle

Maya records the note \`hello\`. \`_all\` returns it with its identity.

## Types

\`\`\`types
external Note
\`\`\`

## State

\`\`\`state
an ordered set of Notes with
  a text Text
\`\`\`

## Actions

\`\`\`actions
note (text: Text) : return (note: Note)
  where text is supplied
  then
    add a new Note with the text after the existing Notes
    return note
\`\`\`

## Queries

\`\`\`queries
_all () : many identified by (note) (note: Note, text: Text)
  Returns every note in recorded order.
\`\`\`
`;

function freshConceptSet() {
  return conceptSet({
    Noting: registerConcept({ class: NotingConcept, spec: notingSpec, refusals: {} }),
  });
}

function pageExports(
  concepts: ReturnType<typeof freshConceptSet>,
  heading: string,
  extra: boolean,
) {
  const { Noting } = concepts.concepts;
  const Page = renderer(
    "Lists the recorded notes.",
    ({ heading: shown }, { note, text }) => html`
      <main>
        <h1>${shown}</h1>
        <ul>
          ${each(Noting._all({}).is({ note, text })).html`<li>${text}</li>`}
        </ul>
      </main>
    `,
  );
  const Home = endpoint("/", () => receive({}).then(respond(Page({ heading }))));
  if (!extra) {
    const Browser = defineInterface({ Home });
    return { exports: { Page, Home, Browser }, Browser };
  }
  const Extra = endpoint("/extra", () => receive({}).then(respond(Page({ heading }))));
  const Browser = defineInterface({ Home, Extra });
  return { exports: { Page, Home, Extra, Browser }, Browser };
}

function streamLines(
  response: Response,
  wanted: (line: { sequence: number; patches: readonly { kind: string }[] }) => boolean,
  timeoutMs = 3_000,
): Promise<{ sequence: number; patches: readonly { kind: string; html?: string }[] }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    const timer = setTimeout(() => {
      void reader.cancel();
      rejectPromise(new Error("No matching stream line arrived in time."));
    }, timeoutMs);
    void (async () => {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffered += decoder.decode(next.value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          if (line === "") continue;
          const parsed = JSON.parse(line) as {
            sequence: number;
            patches: readonly { kind: string; html?: string }[];
          };
          if (wanted(parsed)) {
            clearTimeout(timer);
            void reader.cancel();
            resolvePromise(parsed);
            return;
          }
        }
      }
      clearTimeout(timer);
      rejectPromise(new Error("The stream closed before a matching line arrived."));
    })().catch((error) => {
      clearTimeout(timer);
      rejectPromise(error as Error);
    });
  });
}

function holderOf(document: string): string {
  const match = /data-rendered-holder="([^"]+)"/.exec(document);
  if (match === null) throw new Error("The opening document names no holder.");
  return match[1];
}

function follow(realization: { fetch(request: Request): Promise<Response> }, holder: string) {
  return realization.fetch(
    new Request(`http://system.test/?__sync_holder=${holder}&__sync_after=0`, {
      headers: { accept: "application/x-ndjson" },
    }),
  );
}

test("the three startup precedences are stated completely", () => {
  const selection = { base: "r0", selected: "r1" };
  expect(applySelection({ sourceRevision: "r1", selection })).toEqual({ kind: "spent" });
  expect(applySelection({ sourceRevision: "r0", selection })).toEqual({ kind: "apply" });
  const stale = applySelection({ sourceRevision: "r2", selection });
  expect(stale.kind).toBe("stale");
  expect(stale).toMatchObject({ reason: expect.stringContaining("superseded") });
});

test("a candidate refuses an endpoint that reaches a renderer outside its exports", async () => {
  const Heading = renderer("Shows the heading.", () => html`<h1>Hello</h1>`);
  const Page = renderer("Composes the page.", () => html`<main>${Heading({})}</main>`);
  const Home = endpoint("/", () => receive({}).then(respond(Page({}))));
  const Browser = defineInterface({ Home });
  const system = assemble({
    conceptSet: freshConceptSet(),
    composition: {},
    interfaces: { Heading, Page, Home, Browser },
  });
  await expect(
    assembleCandidate({ system, exports: { Page, Home, Browser }, interface: Browser }),
  ).rejects.toThrow('reaches renderer "Heading" outside the complete interface exports');
});

test("a candidate cannot rename a declaration the accepted interface exports", async () => {
  const concepts = freshConceptSet();
  const accepted = pageExports(concepts, "Accepted", false);
  const system = assemble({
    conceptSet: concepts,
    composition: {},
    interfaces: accepted.exports,
  });
  realize({ system, interface: accepted.Browser });
  const { Page, Home } = accepted.exports as { Page: unknown; Home: unknown };
  await expect(
    assembleCandidate({
      system,
      exports: { Renamed: Page, Home, Browser: accepted.Browser },
      interface: accepted.Browser,
    }),
  ).rejects.toThrow('cannot be installed as both "Page" and "Renamed"');
});

test("revision identity follows canonical content, not module identity", async () => {
  const concepts = freshConceptSet();
  const system = assemble({ conceptSet: concepts, composition: {}, interfaces: {} });
  const first = pageExports(concepts, "One", false);
  const second = pageExports(concepts, "One", false);
  const third = pageExports(concepts, "Two", false);
  const a = await assembleCandidate({ system, exports: first.exports, interface: first.Browser });
  const b = await assembleCandidate({ system, exports: second.exports, interface: second.Browser });
  const c = await assembleCandidate({ system, exports: third.exports, interface: third.Browser });
  expect(a.revision).toBe(b.revision);
  expect(a.revision).not.toBe(c.revision);
  expect(a.path.startsWith("/candidate/")).toBe(true);
  expect(a.manifest).toMatchObject({
    format: "sync-engine.web-candidate",
    interface: "Browser",
    revision: a.revision,
    renderers: ["Page"],
  });
});

test("accepted and candidate holders revise side by side from one settled change", async () => {
  const concepts = freshConceptSet();
  const accepted = pageExports(concepts, "Accepted", false);
  const system = assemble({
    conceptSet: concepts,
    composition: {},
    interfaces: accepted.exports,
  });
  const browser = realize({ system, interface: accepted.Browser });
  const revised = pageExports(concepts, "Revised", false);
  const candidate = await assembleCandidate({
    system,
    exports: revised.exports,
    interface: revised.Browser,
    base: await browser.revision(),
  });

  const acceptedDocument = await (await browser.fetch(new Request("http://system.test/"))).text();
  const previewDocument = await (
    await candidate.realization.fetch(new Request(`http://system.test${candidate.path}/`))
  ).text();
  expect(acceptedDocument).toContain("-->Accepted<!--");
  expect(previewDocument).toContain("-->Revised<!--");

  const acceptedStream = await follow(browser, holderOf(acceptedDocument));
  const previewStream = await candidate.realization.fetch(
    new Request(
      `http://system.test${candidate.path}/?__sync_holder=${holderOf(previewDocument)}&__sync_after=0`,
      {
        headers: { accept: "application/x-ndjson" },
      },
    ),
  );

  await system.concepts.Noting.note({ text: "one settled change" });

  const [acceptedChange, previewChange] = await Promise.all([
    streamLines(acceptedStream, (line) => line.patches.length > 0),
    streamLines(previewStream, (line) => line.patches.length > 0),
  ]);
  expect(JSON.stringify(acceptedChange.patches)).toContain("one settled change");
  expect(JSON.stringify(previewChange.patches)).toContain("one settled change");
});

test("promotion serves the candidate at accepted paths and repairs open holders", async () => {
  const concepts = freshConceptSet();
  const accepted = pageExports(concepts, "Accepted", false);
  const system = assemble({
    conceptSet: concepts,
    composition: {},
    interfaces: accepted.exports,
  });
  const browser = realize({ system, interface: accepted.Browser });

  const openedDocument = await (await browser.fetch(new Request("http://system.test/"))).text();
  expect(openedDocument).toContain("-->Accepted<!--");
  const stream = await follow(browser, holderOf(openedDocument));

  const revised = pageExports(concepts, "Revised", false);
  const candidate = await assembleCandidate({
    system,
    exports: revised.exports,
    interface: revised.Browser,
    base: await browser.revision(),
    source: "// revised page module",
  });
  expect(candidate.manifest.source).toBe("// revised page module");

  const repairArrives = streamLines(stream, (line) =>
    line.patches.some((patch) => patch.kind === "root"),
  );
  await browser.promote(candidate);

  const fresh = await browser.fetch(new Request("http://system.test/"));
  expect(await fresh.text()).toContain("-->Revised<!--");

  const repair = await repairArrives;
  const root = repair.patches.find((patch) => patch.kind === "root");
  expect(root?.html).toContain("-->Revised<!--");
});

test("promotion closes a holder whose endpoint the new interface no longer declares", async () => {
  const concepts = freshConceptSet();
  const accepted = pageExports(concepts, "Accepted", true);
  const system = assemble({
    conceptSet: concepts,
    composition: {},
    interfaces: accepted.exports,
  });
  const browser = realize({ system, interface: accepted.Browser });

  const opened = await browser.fetch(new Request("http://system.test/extra"));
  const holder = holderOf(await opened.text());

  const revised = pageExports(concepts, "Revised", false);
  const candidate = await assembleCandidate({
    system,
    exports: revised.exports,
    interface: revised.Browser,
  });
  await browser.promote(candidate);

  const gone = await browser.fetch(new Request("http://system.test/extra"));
  expect(gone.status).toBe(404);
  const reconnect = await follow(browser, holder);
  expect(reconnect.status).toBe(404);
});

test("restore is promotion pointed at a retained candidate", async () => {
  const concepts = freshConceptSet();
  const accepted = pageExports(concepts, "Accepted", false);
  const system = assemble({
    conceptSet: concepts,
    composition: {},
    interfaces: accepted.exports,
  });
  const browser = realize({ system, interface: accepted.Browser });

  const first = pageExports(concepts, "First", false);
  const second = pageExports(concepts, "Second", false);
  const candidateA = await assembleCandidate({
    system,
    exports: first.exports,
    interface: first.Browser,
  });
  const candidateB = await assembleCandidate({
    system,
    exports: second.exports,
    interface: second.Browser,
  });

  await browser.promote(candidateB);
  expect(await (await browser.fetch(new Request("http://system.test/"))).text()).toContain(
    "-->Second<!--",
  );
  await browser.promote(candidateA);
  expect(await (await browser.fetch(new Request("http://system.test/"))).text()).toContain(
    "-->First<!--",
  );
});

test("a discarded candidate stops serving and touches nothing durable", async () => {
  const concepts = freshConceptSet();
  const accepted = pageExports(concepts, "Accepted", false);
  const system = assemble({
    conceptSet: concepts,
    composition: {},
    interfaces: accepted.exports,
  });
  const browser = realize({ system, interface: accepted.Browser });

  const revised = pageExports(concepts, "Revised", false);
  const candidate = await assembleCandidate({
    system,
    exports: revised.exports,
    interface: revised.Browser,
  });
  const served = await candidate.realization.fetch(
    new Request(`http://system.test${candidate.path}/`),
  );
  expect(served.status).toBe(200);
  candidate.realization.close();
  const after = await candidate.realization.fetch(
    new Request(`http://system.test${candidate.path}/`),
  );
  expect(after.status).toBe(410);
  expect(await (await browser.fetch(new Request("http://system.test/"))).text()).toContain(
    "-->Accepted<!--",
  );
});

test("promotion refuses a candidate assembled against another system", async () => {
  const concepts = freshConceptSet();
  const accepted = pageExports(concepts, "Accepted", false);
  const system = assemble({
    conceptSet: concepts,
    composition: {},
    interfaces: accepted.exports,
  });
  const other = assemble({ conceptSet: freshConceptSet(), composition: {}, interfaces: {} });
  const browser = realize({ system, interface: accepted.Browser });
  const revised = pageExports(concepts, "Revised", false);
  const candidate = await assembleCandidate({
    system: other,
    exports: revised.exports,
    interface: revised.Browser,
  });
  await expect(browser.promote(candidate)).rejects.toThrow("assembled against another system");
});
