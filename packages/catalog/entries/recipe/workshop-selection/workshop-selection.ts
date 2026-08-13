import spec from "./spec.md";
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { former, no, whether, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "@catalog/concepts";

const { Gathering, Selecting } = concepts;
const Workshop = former(
  "the workshop (workshop)",
  ({ workshop }, { name, host, selection, item }) =>
    where(
      Gathering._get({ gathering: workshop }).is({ name, host }),
      whether(Selecting._current({ scope: workshop }).is({ selection, item })),
    ).form({ workshop, name, host, item }),
);
const CreateWorkshop = endpoint("/workshops/create", ({ name, host, workshop: id }) =>
  receive({ name, host })
    .then(Gathering.create({ name, host }).responds({ gathering: id }))
    .then(respond({ workshop: id })),
);
const JoinWorkshop = endpoint("/workshops/join", ({ workshop: id, member, membership }) =>
  receive({ workshop: id, member })
    .then(Gathering.join({ gathering: id, member }).responds({ membership }))
    .then(respond({ membership })),
);
const ChooseWorkshopItem = endpoint("/workshops/choose", ({ workshop: id, item, selection }) =>
  receive({ workshop: id, item }).then(
    where(Gathering._get({ gathering: id }))
      .then(Selecting.choose({ scope: id, item }).responds({ selection }))
      .then(respond({ selection }))
      .named("known-workshop"),
    where(no(Gathering._get({ gathering: id })))
      .then(respond({ error: "GATHERING_NOT_FOUND" }))
      .named("unknown-workshop"),
  ),
);
const GetWorkshop = endpoint("/workshops/get", ({ workshop: id }) =>
  receive({ workshop: id }).then(respond({ workshop: Workshop({ workshop: id }) })),
);

export { spec };

export const compositions = {
  WorkshopMembership: { CreateWorkshop, JoinWorkshop },
  WorkshopSelection: { ChooseWorkshopItem },
  WorkshopPages: { GetWorkshop },
};
export const formers = { Workshop };
