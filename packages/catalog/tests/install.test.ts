import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import ts from "typescript";
import { describe, expect, test } from "vite-plus/test";
import { CatalogRegistry } from "../src/registry.ts";
import { addEntries } from "../src/install.ts";

async function fixture(dependencies: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "catalog-install-"));
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "fixture", packageManager: "bun@1.3.14", dependencies, scripts: { test: "vp test", typecheck: "tsc --noEmit" } }, null, 2)}\n`,
  );
  return root;
}

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory()
          ? typescriptFiles(path)
          : entry.name.endsWith(".ts")
            ? [path]
            : [];
      }),
    )
  ).flat();
}

async function expectTypechecks(root: string): Promise<void> {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  await symlink(resolve(repository, "node_modules"), join(root, "node_modules"), "dir");
  await writeFile(
    join(root, "src/concept-set.ts"),
    'import { conceptSet } from "@mit-sdg/sync-engine/assembly";\nimport { catalogRegistrations } from "./catalog/registrations.generated.ts";\nexport const applicationConcepts = conceptSet({ ...catalogRegistrations });\nexport const { concepts, vocabulary } = applicationConcepts;\n',
  );
  const program = ts.createProgram({
    rootNames: await typescriptFiles(join(root, "src")),
    options: {
      allowImportingTsExtensions: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      paths: {
        "@engine/*": [resolve(repository, "src/engine/*")],
        "@mit-sdg/sync-engine/*": [resolve(repository, "src/*/index.ts")],
        "@node-rs/argon2": [resolve(repository, "packages/catalog/node_modules/@node-rs/argon2")],
        mongodb: [resolve(repository, "packages/catalog/node_modules/mongodb")],
      },
      types: ["node"],
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
    },
  });
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
  ).toEqual([]);
}

describe("catalog installer", () => {
  test("copies only the selected memory floor and deduplicates recipe concepts", async () => {
    const root = await fixture({ "@mit-sdg/sync-engine": "1.0.0-beta.7", "vite-plus": "0.2.6" });
    try {
      const registry = await CatalogRegistry.load();
      const result = await addEntries(registry, ["recipe/workshop-selection"], {
        root,
        floor: "memory",
        originalCommand: "catalog add recipe/workshop-selection --floor memory",
      });
      expect(result.written).toContain("src/concepts/gathering/gathering.memory.ts");
      expect(result.written.some((path) => path.includes("mongo"))).toBe(false);
      const registration = await readFile(join(root, "src/concepts/gathering/registry.ts"), "utf8");
      expect(registration).toContain("class: GatheringMemoryConcept");
      expect(registration).not.toContain("Mongo");
      const recipeTest = await readFile(
        join(root, "src/composition/workshop-selection.test.ts"),
        "utf8",
      );
      expect(recipeTest).toContain('from "../concept-set.ts"');
      expect(recipeTest).toContain('from "../catalog/registrations.generated.ts"');
      expect(recipeTest).not.toContain("@catalog/");
      const lock = JSON.parse(await readFile(join(root, "catalog.lock"), "utf8")) as {
        floor: string;
        entries: Record<string, unknown>;
      };
      expect(lock.floor).toBe("memory");
      expect(Object.keys(lock.entries)).toEqual([
        "concept/gathering",
        "concept/selecting",
        "recipe/workshop-selection",
      ]);
      await expectTypechecks(root);
      const provenance = JSON.parse(await readFile(join(root, "catalog.lock"), "utf8")) as {
        entries: Record<string, { catalogVersion: string; sourceDigest: string }>;
      };
      const repeated = await addEntries(registry, ["recipe/workshop-selection"], {
        root,
        floor: "memory",
        originalCommand: "catalog add recipe/workshop-selection --floor memory",
      });
      expect(repeated.written).toEqual([]);
      const repeatedLock = JSON.parse(
        await readFile(join(root, "catalog.lock"), "utf8"),
      ) as typeof provenance;
      expect(repeatedLock.entries).toEqual(provenance.entries);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  test("copies a mongo-only tree with no memory source or import", async () => {
    const root = await fixture({
      "@mit-sdg/sync-engine": "1.0.0-beta.7",
      mongodb: "6.21.0",
      "vite-plus": "0.2.6",
    });
    try {
      const result = await addEntries(await CatalogRegistry.load(), ["recipe/workshop-selection"], {
        root,
        floor: "mongo",
        originalCommand: "catalog add recipe/workshop-selection --floor mongo",
      });
      expect(result.written).toContain("src/concepts/selecting/selecting.mongo.ts");
      expect(result.written.some((path) => path.includes("memory"))).toBe(false);
      const registry = await readFile(join(root, "src/concepts/selecting/registry.ts"), "utf8");
      expect(registry).toContain("class: SelectingMongoConcept");
      expect(registry).not.toContain("Memory");
      await expectTypechecks(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  test.each(["memory", "mongo"] as const)(
    "installs and typechecks the coordination recipes on the %s floor",
    async (floor) => {
      const root = await fixture({
        "@mit-sdg/sync-engine": "1.0.0-beta.7",
        ...(floor === "mongo" ? { mongodb: "6.21.0" } : {}),
        "vite-plus": "0.2.6",
      });
      try {
        const ids = [
          "recipe/member-reservations",
          "recipe/ranked-discussion",
          "recipe/invite-only-workshop",
        ];
        const result = await addEntries(await CatalogRegistry.load(), ids, {
          root,
          floor,
          originalCommand: `catalog add ${ids.join(" ")} --floor ${floor}`,
        });
        for (const concept of ["gathering", "reserving", "discussing", "upvoting", "inviting"])
          expect(result.written).toContain(`src/concepts/${concept}/${concept}.${floor}.ts`);
        expect(
          result.written.some((path) => path.includes(floor === "memory" ? ".mongo." : ".memory.")),
        ).toBe(false);
        const composition = await readFile(
          join(root, "src/catalog/composition.generated.ts"),
          "utf8",
        );
        for (const member of [
          "ReserveForMember",
          "GetMemberReservations",
          "UpvoteResponse",
          "GetRankedDiscussion",
          "AcceptWorkshopInvitation",
          "RepairAcceptedWorkshopInvitation",
        ])
          expect(composition).toContain(JSON.stringify(member));
        for (const local of ["activeReservations", "rankedResponses", "pendingInvitations"])
          expect(composition).not.toContain(local);
        await expectTypechecks(root);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    30_000,
  );

  test("copies and typechecks the Batch D memory floor without Mongo source", async () => {
    const root = await fixture({ "@mit-sdg/sync-engine": "1.0.0-beta.7", "vite-plus": "0.2.6" });
    try {
      const result = await addEntries(
        await CatalogRegistry.load(),
        ["concept/posting", "concept/commenting", "concept/labeling", "concept/trashing"],
        {
          root,
          floor: "memory",
          originalCommand:
            "catalog add concept/posting concept/commenting concept/labeling concept/trashing --floor memory",
        },
      );
      expect(result.written).toContain("src/concepts/posting/posting.memory.ts");
      expect(result.written).toContain("src/concepts/commenting/commenting.memory.ts");
      expect(result.written).toContain("src/concepts/labeling/labeling.memory.ts");
      expect(result.written).toContain("src/concepts/trashing/trashing.memory.ts");
      expect(result.written.some((path) => path.includes("mongo"))).toBe(false);
      await expectTypechecks(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  test("copies and typechecks the Batch D Mongo floor without memory source", async () => {
    const root = await fixture({
      "@mit-sdg/sync-engine": "1.0.0-beta.7",
      mongodb: "6.21.0",
      "vite-plus": "0.2.6",
    });
    try {
      const result = await addEntries(
        await CatalogRegistry.load(),
        ["concept/posting", "concept/commenting", "concept/labeling", "concept/trashing"],
        {
          root,
          floor: "mongo",
          originalCommand:
            "catalog add concept/posting concept/commenting concept/labeling concept/trashing --floor mongo",
        },
      );
      expect(result.written).toContain("src/concepts/posting/posting.mongo.ts");
      expect(result.written).toContain("src/concepts/commenting/commenting.mongo.ts");
      expect(result.written).toContain("src/concepts/labeling/labeling.mongo.ts");
      expect(result.written).toContain("src/concepts/trashing/trashing.mongo.ts");
      expect(result.written.some((path) => path.includes("memory"))).toBe(false);
      await expectTypechecks(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  test("installs Timing on the mongo floor without MongoDB source or packages", async () => {
    const root = await fixture({
      "@mit-sdg/sync-engine": "1.0.0-beta.7",
      "vite-plus": "0.2.6",
    });
    try {
      const result = await addEntries(await CatalogRegistry.load(), ["concept/timing"], {
        root,
        floor: "mongo",
        originalCommand: "catalog add concept/timing --floor mongo",
      });
      expect(result.written).toContain("src/concepts/timing/timing.ts");
      expect(result.written.some((path) => /timing\.(?:memory|mongo)/.test(path))).toBe(false);
      const registry = await readFile(join(root, "src/concepts/timing/registry.ts"), "utf8");
      expect(registry).toContain("class: TimingConcept");
      expect(registry).not.toContain("mongodb");
      await expectTypechecks(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each(["memory", "mongo"] as const)(
    "installs and typechecks Batch A on the %s floor",
    async (floor) => {
      const root = await fixture({
        "@mit-sdg/sync-engine": "1.0.0-beta.7",
        ...(floor === "mongo" ? { mongodb: "6.21.0" } : {}),
        "vite-plus": "0.2.6",
      });
      try {
        const result = await addEntries(
          await CatalogRegistry.load(),
          ["concept/timing", "concept/upvoting"],
          {
            root,
            floor,
            originalCommand: `catalog add concept/timing concept/upvoting --floor ${floor}`,
          },
        );
        expect(result.written).toContain(`src/concepts/upvoting/upvoting.${floor}.ts`);
        expect(result.written).toContain("src/concepts/timing/timing.ts");
        expect(
          result.written.some((path) =>
            path.includes(`upvoting.${floor === "memory" ? "mongo" : "memory"}`),
          ),
        ).toBe(false);
        await expectTypechecks(root);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  test("installs the Alerting and Reserving memory and mongo floors independently", async () => {
    for (const floor of ["memory", "mongo"] as const) {
      const root = await fixture({
        "@mit-sdg/sync-engine": "1.0.0-beta.7",
        ...(floor === "mongo" ? { mongodb: "6.21.0" } : {}),
        "vite-plus": "0.2.6",
      });
      try {
        const registry = await CatalogRegistry.load();
        const originalCommand = `catalog add concept/alerting concept/reserving --floor ${floor}`;
        const result = await addEntries(registry, ["concept/alerting", "concept/reserving"], {
          root,
          floor,
          originalCommand,
        });
        expect(result.written).toContain(`src/concepts/alerting/alerting.${floor}.ts`);
        expect(result.written).toContain(`src/concepts/reserving/reserving.${floor}.ts`);
        const omittedFloor = floor === "memory" ? "mongo" : "memory";
        expect(result.written.some((path) => path.includes(`.${omittedFloor}.`))).toBe(false);
        for (const concept of ["alerting", "reserving"] as const) {
          const conceptName = concept === "alerting" ? "Alerting" : "Reserving";
          const selectedClass = `${conceptName}${floor === "memory" ? "Memory" : "Mongo"}Concept`;
          const omittedClass = `${conceptName}${floor === "memory" ? "Mongo" : "Memory"}Concept`;
          const registration = await readFile(
            join(root, `src/concepts/${concept}/registry.ts`),
            "utf8",
          );
          expect(registration).toContain(`class: ${selectedClass}`);
          expect(registration).not.toContain(omittedClass);
        }
        await expectTypechecks(root);
        const repeated = await addEntries(registry, ["concept/alerting", "concept/reserving"], {
          root,
          floor,
          originalCommand,
        });
        expect(repeated.written).toEqual([]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  }, 30_000);

  test.each(["memory", "mongo"] as const)(
    "copies and typechecks Approving on the %s floor",
    async (floor) => {
      const dependencies: Record<string, string> = {
        "@mit-sdg/sync-engine": "1.0.0-beta.7",
        "vite-plus": "0.2.6",
      };
      if (floor === "mongo") dependencies.mongodb = "6.21.0";
      const root = await fixture(dependencies);
      try {
        const result = await addEntries(await CatalogRegistry.load(), ["concept/approving"], {
          root,
          floor,
          originalCommand: `catalog add concept/approving --floor ${floor}`,
        });
        expect(result.written).toContain(`src/concepts/approving/approving.${floor}.ts`);
        expect(
          result.written.some((path) => path.includes(floor === "memory" ? "mongo" : "memory")),
        ).toBe(false);
        const registry = await readFile(join(root, "src/concepts/approving/registry.ts"), "utf8");
        expect(registry).toContain(
          `class: Approving${floor === "memory" ? "Memory" : "Mongo"}Concept`,
        );
        expect(registry).not.toContain(floor === "memory" ? "Mongo" : "Memory");
        await expectTypechecks(root);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  test.each(["memory", "mongo"] as const)(
    "copies and typechecks the security concepts on the %s floor",
    async (floor) => {
      const root = await fixture({
        "@mit-sdg/sync-engine": "1.0.0-beta.7",
        "@node-rs/argon2": "2.0.2",
        ...(floor === "mongo" ? { mongodb: "6.21.0" } : {}),
        "vite-plus": "0.2.6",
      });
      try {
        const result = await addEntries(
          await CatalogRegistry.load(),
          ["concept/sessioning", "concept/authenticating"],
          {
            root,
            floor,
            originalCommand: `catalog add concept/sessioning concept/authenticating --floor ${floor}`,
          },
        );
        expect(result.written).toContain(`src/concepts/sessioning/sessioning.${floor}.ts`);
        expect(result.written).toContain(`src/concepts/authenticating/authenticating.${floor}.ts`);
        expect(
          result.written.some((path) => path.includes(floor === "mongo" ? ".memory." : ".mongo.")),
        ).toBe(false);

        const sessioningRegistry = await readFile(
          join(root, "src/concepts/sessioning/registry.ts"),
          "utf8",
        );
        const authenticatingRegistry = await readFile(
          join(root, "src/concepts/authenticating/registry.ts"),
          "utf8",
        );
        expect(sessioningRegistry).toContain(
          `class: Sessioning${floor === "mongo" ? "Mongo" : "Memory"}Concept`,
        );
        expect(authenticatingRegistry).toContain(
          `class: Authenticating${floor === "mongo" ? "Mongo" : "Memory"}Concept`,
        );
        expect(sessioningRegistry).not.toContain(floor === "mongo" ? "Memory" : "Mongo");
        expect(authenticatingRegistry).not.toContain(floor === "mongo" ? "Memory" : "Mongo");
        await expectTypechecks(root);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    30_000,
  );

  test("installs and typechecks the board recipes on both floors", async () => {
    for (const recipe of ["incident-room", "recoverable-board"] as const) {
      for (const floor of ["memory", "mongo"] as const) {
        const root = await fixture({
          "@mit-sdg/sync-engine": "1.0.0-beta.7",
          ...(floor === "mongo" ? { mongodb: "6.21.0" } : {}),
          "vite-plus": "0.2.6",
        });
        try {
          const id = `recipe/${recipe}`;
          const result = await addEntries(await CatalogRegistry.load(), [id], {
            root,
            floor,
            originalCommand: `catalog add ${id} --floor ${floor}`,
          });
          expect(result.written).toContain(`src/composition/${recipe}.ts`);
          expect(result.written).toContain(`src/composition/${recipe}.test.ts`);
          expect(
            result.written.some((path) =>
              path.includes(floor === "memory" ? ".mongo." : ".memory."),
            ),
          ).toBe(false);
          const composition = await readFile(
            join(root, "src/catalog/composition.generated.ts"),
            "utf8",
          );
          expect(composition).toContain(
            recipe === "incident-room" ? "RepairMitigationEffects" : "ListRecoverableBoard",
          );
          await expectTypechecks(root);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    }
  }, 60_000);

  test.each(["memory", "mongo"] as const)(
    "installs and typechecks the security recipes on the %s floor",
    async (floor) => {
      const root = await fixture({
        "@mit-sdg/sync-engine": "1.0.0-beta.7",
        "@node-rs/argon2": "2.0.2",
        ...(floor === "mongo" ? { mongodb: "6.21.0" } : {}),
        "vite-plus": "0.2.6",
      });
      try {
        const result = await addEntries(
          await CatalogRegistry.load(),
          ["recipe/review-queue", "recipe/message-board"],
          {
            root,
            floor,
            originalCommand: `catalog add recipe/review-queue recipe/message-board --floor ${floor}`,
          },
        );
        expect(result.written).toContain("src/composition/review-queue.ts");
        expect(result.written).toContain("src/composition/message-board.ts");
        expect(
          result.written.some((path) => path.includes(floor === "mongo" ? ".memory." : ".mongo.")),
        ).toBe(false);
        const generated = await readFile(
          join(root, "src/catalog/composition.generated.ts"),
          "utf8",
        );
        expect(generated).toContain("RepairReviewAlert");
        expect(generated).toContain("DeleteBoardAccount");
        await expectTypechecks(root);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    45_000,
  );

  test("rejects unavailable floors and untracked collisions before writing", async () => {
    const dependencies = { "@mit-sdg/sync-engine": "1.0.0-beta.7", "vite-plus": "0.2.6" };
    const unavailable = await fixture(dependencies);
    try {
      await expect(
        addEntries(await CatalogRegistry.load(), ["concept/selecting"], {
          root: unavailable,
          floor: "sqlite",
          originalCommand: "catalog add concept/selecting --floor sqlite",
        }),
      ).rejects.toThrow("does not provide floor");
      await expect(readFile(join(unavailable, "catalog.lock"), "utf8")).rejects.toThrow();
    } finally {
      await rm(unavailable, { recursive: true, force: true });
    }

    const collision = await fixture(dependencies);
    try {
      await mkdir(join(collision, "src/concepts/selecting"), { recursive: true });
      await writeFile(join(collision, "src/concepts/selecting/spec.md"), "application source\n");
      await expect(
        addEntries(await CatalogRegistry.load(), ["concept/selecting"], {
          root: collision,
          originalCommand: "catalog add concept/selecting",
        }),
      ).rejects.toThrow("not catalog-owned");
      await expect(readFile(join(collision, "catalog.lock"), "utf8")).rejects.toThrow();
    } finally {
      await rm(collision, { recursive: true, force: true });
    }
  });

  test("protects the locked floor and edited generated and rendered files", async () => {
    const root = await fixture({ "@mit-sdg/sync-engine": "1.0.0-beta.7", "vite-plus": "0.2.6" });
    try {
      const registry = await CatalogRegistry.load();
      await addEntries(registry, ["concept/selecting"], {
        root,
        floor: "memory",
        originalCommand: "catalog add concept/selecting --floor memory",
      });
      await expect(
        addEntries(registry, ["concept/gathering"], {
          root,
          floor: "mongo",
          originalCommand: "catalog add concept/gathering --floor mongo",
        }),
      ).rejects.toThrow("selects floor memory");
      const generatedPath = join(root, "src/catalog/composition.generated.ts");
      const originalGenerated = await readFile(generatedPath, "utf8");
      await writeFile(generatedPath, "edited\n");
      await expect(
        addEntries(registry, ["concept/selecting"], {
          root,
          originalCommand: "catalog add concept/selecting",
        }),
      ).rejects.toThrow("generated file was edited");
      await writeFile(generatedPath, originalGenerated);
      await writeFile(join(root, "src/concepts/selecting/registry.ts"), "edited\n");
      await expect(
        addEntries(registry, ["concept/selecting"], {
          root,
          originalCommand: "catalog add concept/selecting",
        }),
      ).rejects.toThrow("edited");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports one install command and writes nothing when packages are missing", async () => {
    const root = await fixture({});
    try {
      const result = await addEntries(await CatalogRegistry.load(), ["concept/selecting"], {
        root,
        originalCommand: "catalog add concept/selecting",
      });
      expect(result.install).toContain("bun add --exact");
      await expect(readFile(join(root, "catalog.lock"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
