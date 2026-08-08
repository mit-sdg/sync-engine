import { reaction, when } from "@mit-sdg/sync-engine/language";
import { concepts } from "@catalog/concepts";

const { Alerting, Gathering, Selecting } = concepts;

/** Notify every member of a gathering when its selected item changes. */
export const SelectionAlertsMembers = reaction(({ gathering, selection, member }) =>
  when(Selecting.choose({ scope: gathering }).responds({ selection }))
    .where(Gathering._members({ gathering }).is({ member }))
    .then(Alerting.raise({ recipient: member, subject: selection })),
);
