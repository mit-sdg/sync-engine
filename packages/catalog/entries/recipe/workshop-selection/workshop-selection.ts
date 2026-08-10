import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { former, whether, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "@catalog/concepts";

const { Gathering, Selecting } = concepts;
const workshop = former(
  "the workshop (workshop)",
  ({ workshop }, { name, host, selection, item }) =>
    where(
      Gathering._get({ gathering: workshop }).is({ name, host }),
      whether(Selecting._current({ scope: workshop }).is({ selection, item })),
    ).form({ workshop, name, host, item }),
);
export const CreateWorkshop = endpoint("/workshops/create", ({ name, host, workshop: id }) =>
  receive({ name, host })
    .then(Gathering.create({ name, host }).responds({ gathering: id }))
    .then(respond({ workshop: id })),
);
export const JoinWorkshop = endpoint("/workshops/join", ({ workshop: id, member, membership }) =>
  receive({ workshop: id, member })
    .then(Gathering.join({ gathering: id, member }).responds({ membership }))
    .then(respond({ membership })),
);
export const ChooseWorkshopItem = endpoint(
  "/workshops/choose",
  ({ workshop: id, item, selection }) =>
    receive({ workshop: id, item })
      .then(Selecting.choose({ scope: id, item }).responds({ selection }))
      .then(respond({ selection })),
);
export const GetWorkshop = endpoint("/workshops/get", ({ workshop: id }) =>
  receive({ workshop: id }).then(respond({ workshop: workshop({ workshop: id }) })),
);
