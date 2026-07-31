import { describe, expect, test } from "vite-plus/test";
import { ReactionCatalog } from "@sync-engine/internal/reactions/runtime/reaction-catalog.ts";
import type {
  ExecutableReaction,
  InstrumentedAction,
} from "@sync-engine/internal/reactions/types.ts";

describe("reaction catalog", () => {
  test("owns name, action, channel, and base-registration indexes together", () => {
    const concept = {};
    const action = (async () => ({})) as InstrumentedAction;
    action.concept = concept;
    const reaction: ExecutableReaction = {
      name: "Observe",
      when: [
        { concept, action, input: {}, output: {}, flow: Symbol("flow") },
        { channel: "returned", pattern: {}, except: [] },
      ],
      then: [],
    };
    const catalog = new ReactionCatalog();

    catalog.index(reaction);
    catalog.finishBase("Observe", ["Observe"], []);

    expect(catalog.ownerOf("Observe")).toBe("Observe");
    expect(catalog.candidates(action, "returned")).toEqual(new Set([reaction]));
    expect(catalog.reactionsByAction.get(action)).toEqual(new Set([reaction]));
    expect(catalog.reactionsByChannel.get("returned")).toEqual(new Set([reaction]));

    catalog.unregisterBase("Observe");
    expect(catalog.ownerOf("Observe")).toBeUndefined();
    expect(catalog.reactions.Observe).toBeUndefined();
    expect(catalog.reactionsByAction.has(action)).toBe(false);
    expect(catalog.reactionsByChannel.has("returned")).toBe(false);
    expect(catalog.candidates(action, "returned")).toBeUndefined();
  });
});
