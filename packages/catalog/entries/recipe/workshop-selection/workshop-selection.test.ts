import { assemble } from "@mit-sdg/sync-engine/assembly";
import { expect, test } from "vite-plus/test";
import { vocabulary } from "@catalog/concepts";
import {
  ChooseWorkshopItem,
  CreateWorkshop,
  GetWorkshop,
  JoinWorkshop,
} from "./workshop-selection.ts";

test("exports the declared composition members", () => {
  expect(CreateWorkshop).toBeDefined();
  expect(JoinWorkshop).toBeDefined();
  expect(ChooseWorkshopItem).toBeDefined();
  expect(GetWorkshop).toBeDefined();
});

test("runs the declared workshop endpoints", async () => {
  const gatherings = new Map<string, { gathering: string; name: string; host: string }>();
  const members = new Map<string, string[]>();
  const gathering = {
    create({ name, host }: { name: string; host: string }) {
      const id = "workshop";
      gatherings.set(id, { gathering: id, name, host });
      members.set(id, [host]);
      return { gathering: id };
    },
    join({ gathering: id, member }: { gathering: string; member: string }) {
      members.get(id)?.push(member);
      return { membership: `${id}:${member}` };
    },
    leave({ gathering: id, member }: { gathering: string; member: string }) {
      members.set(
        id,
        (members.get(id) ?? []).filter((candidate) => candidate !== member),
      );
      return { membership: `${id}:${member}` };
    },
    _get({ gathering: id }: { gathering: string }) {
      const found = gatherings.get(id);
      return found === undefined ? [] : [found];
    },
    _members({ gathering: id }: { gathering: string }) {
      return (members.get(id) ?? []).map((member) => ({ member }));
    },
    _membership({ gathering: id, member }: { gathering: string; member: string }) {
      return { joined: members.get(id)?.includes(member) ?? false };
    },
  };
  const selections = new Map<string, { selection: string; scope: string; item: string }>();
  const selecting = {
    choose({ scope, item }: { scope: string; item: string }) {
      const selection = "selection";
      selections.set(scope, { selection, scope, item });
      return { selection };
    },
    clear({ scope }: { scope: string }) {
      const selection = selections.get(scope)?.selection ?? "selection";
      selections.delete(scope);
      return { selection };
    },
    _current({ scope }: { scope: string }) {
      const found = selections.get(scope);
      return found === undefined ? [] : [found];
    },
    _get({ selection }: { selection: string }) {
      return [...selections.values()].filter((found) => found.selection === selection);
    },
  };
  const application = assemble({
    vocabulary,
    instances: { Gathering: gathering, Selecting: selecting } as never,
    composition: { ChooseWorkshopItem, CreateWorkshop, GetWorkshop, JoinWorkshop },
  });
  const created = await application.invoker.invoke(
    "/workshops/create" as never,
    {
      name: "Workshop",
      host: "Asha",
    } as never,
  );
  expect(created).toMatchObject({ ok: true });
  const workshop = "workshop";
  await expect(
    application.invoker.invoke("/workshops/join" as never, { workshop, member: "Bo" } as never),
  ).resolves.toMatchObject({ ok: true });
  await expect(
    application.invoker.invoke("/workshops/choose" as never, { workshop, item: "Essay" } as never),
  ).resolves.toMatchObject({ ok: true });
  await expect(
    application.invoker.invoke("/workshops/get" as never, { workshop } as never),
  ).resolves.toMatchObject({ ok: true });
});
