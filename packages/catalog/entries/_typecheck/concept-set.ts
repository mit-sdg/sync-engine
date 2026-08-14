import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { alerting } from "../concept/alerting/registry.ts";
import { approving } from "../concept/approving/registry.ts";
import { auditing } from "../concept/auditing/registry.ts";
import { authenticating } from "../concept/authenticating/registry.ts";
import { commenting } from "../concept/commenting/registry.ts";
import { discussing } from "../concept/discussing/registry.ts";
import { gathering } from "../concept/gathering/registry.ts";
import { inviting } from "../concept/inviting/registry.ts";
import { labeling } from "../concept/labeling/registry.ts";
import { posting } from "../concept/posting/registry.ts";
import { reserving } from "../concept/reserving/registry.ts";
import { selecting } from "../concept/selecting/registry.ts";
import { sessioning } from "../concept/sessioning/registry.ts";
import { timing } from "../concept/timing/registry.ts";
import { trashing } from "../concept/trashing/registry.ts";
import { upvoting } from "../concept/upvoting/registry.ts";

export const applicationConcepts = conceptSet({
  Alerting: alerting,
  Approving: approving,
  Auditing: auditing,
  Authenticating: authenticating,
  Commenting: commenting,
  Discussing: discussing,
  Gathering: gathering,
  Inviting: inviting,
  Labeling: labeling,
  Posting: posting,
  Reserving: reserving,
  Selecting: selecting,
  Sessioning: sessioning,
  Timing: timing,
  Trashing: trashing,
  Upvoting: upvoting,
});
export const { concepts } = applicationConcepts;
