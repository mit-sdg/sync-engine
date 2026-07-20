import { reaction, request, when } from "@mit-sdg/sync-engine/language";
import { concepts } from "../concept-set.ts";

const { Alerting, Discussing, Gathering, Selecting } = concepts;

export const SelectedMitigationOpensDiscussion = reaction(({ selection }) =>
  when(Selecting.choose, {}, { selection }).then(request(Discussing.open, { subject: selection })),
);

export const SelectedMitigationAlertsResponders = reaction(({ room, selection, responder }) =>
  when(Selecting.choose, { scope: room }, { selection })
    .where(Gathering._members({ gathering: room }).is({ member: responder }))
    .then(request(Alerting.raise, { recipient: responder, subject: selection })),
);
