import { assemble } from "@mit-sdg/sync-engine/assembly";
import { describe, expect, test } from "vite-plus/test";
import { vocabulary } from "@catalog/concepts";
import { catalogRegistrations } from "@catalog/registrations";
import {
  ChooseWorkshopItem,
  CreateWorkshop,
  GetWorkshop,
  JoinWorkshop,
} from "./workshop-selection.ts";

type Awaitable<T> = T | Promise<T>;
type FloorFactory = (context: unknown) => object;

interface RegistrationWithFloors {
  floors?: Record<string, FloorFactory>;
}

interface SelectingTestImplementation {
  _current(input: {
    scope: string;
  }): Awaitable<{ selection: string; scope: string; item: string }[]>;
}

interface WorkshopInstances {
  Gathering: object;
  Selecting: object & SelectingTestImplementation;
}

interface TestDatabase {
  admin(): {
    command(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  dropDatabase(): Promise<unknown>;
}

interface TestMongoClient {
  connect(): Promise<unknown>;
  db(name: string): TestDatabase;
  close(): Promise<unknown>;
}

type TestMongoClientConstructor = new (uri: string) => TestMongoClient;

const registrations = catalogRegistrations as unknown as Record<
  "Gathering" | "Selecting",
  RegistrationWithFloors
>;
const environment = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process.env;
const mongoEnabled =
  environment.MONGODB_URI !== undefined && environment.CATALOG_SKIP_MONGO !== "1";

function floorAvailable(floor: string): boolean {
  return [registrations.Gathering, registrations.Selecting].every((registration) =>
    Object.hasOwn(registration.floors ?? {}, floor),
  );
}

function workshopInstances(floor: string, context: unknown): WorkshopInstances {
  const gatheringFactory = registrations.Gathering.floors?.[floor];
  const selectingFactory = registrations.Selecting.floors?.[floor];
  if (gatheringFactory === undefined || selectingFactory === undefined)
    throw new Error(`Workshop Selection test cannot construct the ${floor} floor.`);
  return {
    Gathering: gatheringFactory(context),
    Selecting: selectingFactory(context) as object & SelectingTestImplementation,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function successValue(result: unknown): Record<string, unknown> {
  if (!record(result) || result.ok !== true || !record(result.value))
    throw new Error("Workshop Selection expected a successful object result.");
  return result.value;
}

function stringField(value: Record<string, unknown>, field: string): string {
  const found = value[field];
  if (typeof found !== "string")
    throw new Error(`Workshop Selection expected ${field} to be a string.`);
  return found;
}

async function exerciseWorkshopSelection(instances: WorkshopInstances): Promise<void> {
  const application = assemble({
    vocabulary,
    instances: { Gathering: instances.Gathering, Selecting: instances.Selecting } as never,
    composition: { ChooseWorkshopItem, CreateWorkshop, GetWorkshop, JoinWorkshop },
  });

  const created: unknown = await application.invoker.invoke(
    "/workshops/create" as never,
    { name: "Saturday Workshop", host: "Asha" } as never,
  );
  const workshop = stringField(successValue(created), "workshop");
  expect(created).toEqual({ ok: true, value: { workshop } });

  const initial: unknown = await application.invoker.invoke(
    "/workshops/get" as never,
    { workshop } as never,
  );
  expect(initial).toEqual({
    ok: true,
    value: {
      workshop: {
        workshop,
        name: "Saturday Workshop",
        host: "Asha",
        item: null,
      },
    },
  });

  const joined: unknown = await application.invoker.invoke(
    "/workshops/join" as never,
    { workshop, member: "Bo" } as never,
  );
  const membership = stringField(successValue(joined), "membership");
  expect(joined).toEqual({ ok: true, value: { membership } });
  expect(
    await application.invoker.invoke(
      "/workshops/join" as never,
      { workshop, member: "Bo" } as never,
    ),
  ).toEqual({ ok: false, error: { kind: "domain", value: "ALREADY_JOINED" } });
  expect(
    await application.invoker.invoke(
      "/workshops/join" as never,
      { workshop: "unknown", member: "Cy" } as never,
    ),
  ).toEqual({ ok: false, error: { kind: "domain", value: "GATHERING_NOT_FOUND" } });

  expect(
    await application.invoker.invoke(
      "/workshops/choose" as never,
      { workshop: "unknown", item: "Essay X" } as never,
    ),
  ).toEqual({ ok: false, error: { kind: "domain", value: "GATHERING_NOT_FOUND" } });
  expect(await instances.Selecting._current({ scope: "unknown" })).toEqual([]);

  const chosen: unknown = await application.invoker.invoke(
    "/workshops/choose" as never,
    { workshop, item: "Essay A" } as never,
  );
  const selection = stringField(successValue(chosen), "selection");
  expect(chosen).toEqual({ ok: true, value: { selection } });
  expect(
    await application.invoker.invoke("/workshops/get" as never, { workshop } as never),
  ).toEqual({
    ok: true,
    value: {
      workshop: {
        workshop,
        name: "Saturday Workshop",
        host: "Asha",
        item: "Essay A",
      },
    },
  });
}

async function mongoClientConstructor(): Promise<TestMongoClientConstructor> {
  const packageName = "mongodb";
  const loaded: unknown = await import(packageName);
  if (!record(loaded) || typeof loaded.MongoClient !== "function")
    throw new Error("The mongodb package does not export MongoClient.");
  return loaded.MongoClient as TestMongoClientConstructor;
}

async function requireTransactionTopology(db: TestDatabase): Promise<void> {
  const hello = await db.admin().command({ hello: 1 });
  if (
    typeof hello.logicalSessionTimeoutMinutes !== "number" ||
    (typeof hello.setName !== "string" && hello.msg !== "isdbgrid")
  )
    throw new Error(
      "Workshop Selection's Mongo floor requires a transaction-capable replica set or sharded cluster.",
    );
}

test("exports only the declared endpoint composition members", () => {
  expect(CreateWorkshop).toBeDefined();
  expect(JoinWorkshop).toBeDefined();
  expect(ChooseWorkshopItem).toBeDefined();
  expect(GetWorkshop).toBeDefined();
});

describe.skipIf(!floorAvailable("memory"))("Workshop Selection memory", () => {
  test("returns exact endpoint results and refusals with real concepts", async () => {
    await exerciseWorkshopSelection(workshopInstances("memory", {}));
  });
});

describe.skipIf(!mongoEnabled || !floorAvailable("mongo"))("Workshop Selection mongo", () => {
  test("returns the same exact endpoint results and refusals with real concepts", async () => {
    const MongoClient = await mongoClientConstructor();
    const client = new MongoClient(environment.MONGODB_URI ?? "");
    await client.connect();
    const db = client.db(`catalog_workshop_selection_${crypto.randomUUID()}`);
    try {
      await requireTransactionTopology(db);
      await exerciseWorkshopSelection(workshopInstances("mongo", { db }));
    } finally {
      try {
        await db.dropDatabase();
      } finally {
        await client.close();
      }
    }
  });
});
