import { buildPrompt } from "../packages/skill/skills/sync-engine/scripts/prompt.ts";

const promptRoot = "packages/skill/skills/sync-engine/prompts";
const fixtures = "packages/skill/tests/fixtures";

export const hashManifestPath = `${fixtures}/prompt-hashes.json`;

/** Every golden the skill pins, so no one hand-runs a one-off build to refresh them. */
export const goldens = [
  {
    role: "designer",
    mode: "map",
    path: `${fixtures}/task-manager/designer.prompt.txt`,
    inputs: [{ slot: "brief", path: `${fixtures}/task-manager/brief.md` }],
  },
  {
    role: "critic",
    mode: "contract",
    path: `${fixtures}/message-board/critic.prompt.txt`,
    inputs: [
      { slot: "brief", path: `${fixtures}/message-board/brief.md` },
      { slot: "candidate", path: `${fixtures}/message-board/candidate.md` },
    ],
  },
] as const;

export async function buildGolden(golden: (typeof goldens)[number]) {
  return buildPrompt({
    role: golden.role,
    mode: golden.mode,
    promptRoot,
    inputs: [...golden.inputs],
  });
}
