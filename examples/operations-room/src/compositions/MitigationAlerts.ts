import { reaction, when } from "@mit-sdg/sync-engine/language";
import { concepts } from "../vocabulary.ts";

const { Alerting, Gathering, Selecting } = concepts;

// Only current room members receive an alert from this selectable pack.
const SelectedMitigationAlertsResponders = reaction(({ room, selection, responder }) =>
  when(Selecting.choose({ scope: room }).responds({ selection }))
    .where(Gathering._members({ gathering: room }).is({ member: responder }))
    .then(Alerting.raise({ recipient: responder, subject: selection })),
);

export const composition = { SelectedMitigationAlertsResponders };
