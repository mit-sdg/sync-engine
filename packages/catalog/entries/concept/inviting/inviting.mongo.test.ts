import type { Db } from "mongodb";
import { MongoClient } from "mongodb";
import { describe, expect, test } from "vite-plus/test";
import {
  InvitationAlreadyPending,
  InvitationNotPendingForInvitee,
  InvitationNotPendingForInviter,
} from "./inviting.shared.ts";
import { InvitingMongoConcept } from "./inviting.mongo.ts";

const environment = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process.env;
const enabled = environment.MONGODB_URI !== undefined && environment.CATALOG_SKIP_MONGO !== "1";
const instant = (minute: number) =>
  new Date(`2099-07-20T12:${String(minute).padStart(2, "0")}:00.000Z`);

async function withDatabase(run: (db: Db) => Promise<void>): Promise<void> {
  const client = new MongoClient(environment.MONGODB_URI ?? "");
  try {
    await client.connect();
    const db = client.db(`catalog_inviting_${crypto.randomUUID()}`);
    try {
      await run(db);
    } finally {
      await db.dropDatabase();
    }
  } finally {
    await client.close();
  }
}

async function rejection(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  return undefined;
}

function rejected(results: PromiseSettledResult<unknown>[]): unknown[] {
  return results.flatMap((result) =>
    result.status === "rejected" ? [result.reason as unknown] : [],
  );
}

describe("Inviting mongo", () => {
  test.skipIf(!enabled)("its directed-invitation principle, refusals, and order", async () => {
    await withDatabase(async (db) => {
      const ids = [
        "accepted",
        "pending-z",
        "pending-b",
        "pending-a",
        "after-decline",
        "after-revoke",
      ];
      const inviting = new InvitingMongoConcept(db, () => ids.shift() ?? "unexpected");

      expect(
        await inviting.issue({
          target: "workshop-4",
          inviter: "Ari",
          invitee: "Bo",
          at: instant(0),
        }),
      ).toEqual({ invitation: "accepted" });
      const duplicate = await rejection(() =>
        inviting.issue({ target: "workshop-4", inviter: "Cy", invitee: "Bo", at: instant(1) }),
      );
      expect(duplicate).toBeInstanceOf(InvitationAlreadyPending);
      expect((duplicate as Error).message).toBe(
        "This person already has a pending invitation for the target.",
      );

      const wrongInvitee = await rejection(() =>
        inviting.accept({ invitation: "accepted", invitee: "Cy", at: instant(2) }),
      );
      expect(wrongInvitee).toBeInstanceOf(InvitationNotPendingForInvitee);
      expect((wrongInvitee as Error).message).toBe(
        "There is no such pending invitation for this invitee.",
      );
      expect((await inviting._get({ invitation: "accepted" }))[0]?.status).toBe("pending");
      const wrongInviter = await rejection(() =>
        inviting.revoke({ invitation: "accepted", inviter: "Cy", at: instant(2) }),
      );
      expect(wrongInviter).toBeInstanceOf(InvitationNotPendingForInviter);
      expect((wrongInviter as Error).message).toBe(
        "There is no such pending invitation for this inviter.",
      );
      expect((await inviting._get({ invitation: "accepted" }))[0]?.status).toBe("pending");

      expect(
        await inviting.accept({ invitation: "accepted", invitee: "Bo", at: instant(3) }),
      ).toEqual({ invitation: "accepted" });
      expect(await inviting._get({ invitation: "accepted" })).toEqual([
        {
          target: "workshop-4",
          inviter: "Ari",
          invitee: "Bo",
          status: "accepted",
          issuedAt: instant(0),
          decidedAt: instant(3),
        },
      ]);
      expect(
        await rejection(() =>
          inviting.accept({ invitation: "accepted", invitee: "Bo", at: instant(4) }),
        ),
      ).toBeInstanceOf(InvitationNotPendingForInvitee);
      const lateRevoke = await rejection(() =>
        inviting.revoke({ invitation: "accepted", inviter: "Ari", at: instant(4) }),
      );
      expect(lateRevoke).toBeInstanceOf(InvitationNotPendingForInviter);
      expect((lateRevoke as Error).message).toBe(
        "There is no such pending invitation for this inviter.",
      );

      await inviting.issue({ target: "third", inviter: "A", invitee: "Cy", at: instant(6) });
      await inviting.issue({ target: "first", inviter: "B", invitee: "Cy", at: instant(5) });
      await inviting.issue({ target: "second", inviter: "C", invitee: "Cy", at: instant(6) });
      expect(
        (await inviting._pendingFor({ invitee: "Cy" })).map(({ invitation }) => invitation),
      ).toEqual(["pending-b", "pending-a", "pending-z"]);

      await inviting.decline({ invitation: "pending-z", invitee: "Cy", at: instant(7) });
      expect(
        await inviting.issue({ target: "third", inviter: "A", invitee: "Cy", at: instant(8) }),
      ).toEqual({ invitation: "after-decline" });
      await inviting.revoke({ invitation: "after-decline", inviter: "A", at: instant(9) });
      expect(
        await inviting.issue({ target: "third", inviter: "A", invitee: "Cy", at: instant(10) }),
      ).toEqual({ invitation: "after-revoke" });
      expect(await inviting._get({ invitation: "missing" })).toEqual([]);
      expect(await inviting._pendingFor({ invitee: "missing" })).toEqual([]);
    });
  });

  test.skipIf(!enabled)(
    "uses a partial unique index and conditional updates for issue and decision races",
    async () => {
      await withDatabase(async (db) => {
        const issueIDs = ["issue-a", "issue-b"];
        const issuing = new InvitingMongoConcept(db, () => issueIDs.shift() ?? "unexpected-issue");
        const issues = await Promise.allSettled([
          issuing.issue({ target: "workshop", inviter: "Ari", invitee: "Bo", at: instant(0) }),
          issuing.issue({ target: "workshop", inviter: "Cy", invitee: "Bo", at: instant(0) }),
        ]);
        expect(issues.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
        expect(rejected(issues)).toHaveLength(1);
        expect(rejected(issues)[0]).toBeInstanceOf(InvitationAlreadyPending);
        expect(await issuing._pendingFor({ invitee: "Bo" })).toHaveLength(1);

        const transitionIDs = ["accept-revoke", "accept-decline"];
        const transitions = new InvitingMongoConcept(
          db,
          () => transitionIDs.shift() ?? "unexpected-transition",
        );
        await transitions.issue({ target: "one", inviter: "Ari", invitee: "Bo", at: instant(1) });
        const acceptRevoke = await Promise.allSettled([
          transitions.accept({ invitation: "accept-revoke", invitee: "Bo", at: instant(2) }),
          transitions.revoke({ invitation: "accept-revoke", inviter: "Ari", at: instant(2) }),
        ]);
        expect(acceptRevoke.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
        expect(rejected(acceptRevoke)).toHaveLength(1);
        expect(
          rejected(acceptRevoke)[0] instanceof InvitationNotPendingForInvitee ||
            rejected(acceptRevoke)[0] instanceof InvitationNotPendingForInviter,
        ).toBe(true);

        await transitions.issue({ target: "two", inviter: "Ari", invitee: "Bo", at: instant(3) });
        const acceptDecline = await Promise.allSettled([
          transitions.accept({ invitation: "accept-decline", invitee: "Bo", at: instant(4) }),
          transitions.decline({ invitation: "accept-decline", invitee: "Bo", at: instant(4) }),
        ]);
        expect(acceptDecline.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
        expect(rejected(acceptDecline)[0]).toBeInstanceOf(InvitationNotPendingForInvitee);
      });
    },
  );
});
