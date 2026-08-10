import { describe, expect, test } from "vite-plus/test";
import {
  InvitationAlreadyPending,
  InvitationNotPendingForInvitee,
  InvitationNotPendingForInviter,
} from "./inviting.shared.ts";
import { InvitingMemoryConcept } from "./inviting.memory.ts";

const instant = (minute: number) =>
  new Date(`2099-07-20T12:${String(minute).padStart(2, "0")}:00.000Z`);

function thrown(operation: () => unknown): unknown {
  try {
    operation();
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

describe("Inviting memory", () => {
  test("its directed-invitation principle and refusal contract", () => {
    const ids = ["accepted", "declined", "after-decline", "revoked", "after-revoke"];
    const inviting = new InvitingMemoryConcept(() => ids.shift() ?? "unexpected");

    expect(
      inviting.issue({ target: "workshop-4", inviter: "Ari", invitee: "Bo", at: instant(0) }),
    ).toEqual({ invitation: "accepted" });
    expect(inviting._pendingFor({ invitee: "Bo" })).toEqual([
      { invitation: "accepted", target: "workshop-4", inviter: "Ari", issuedAt: instant(0) },
    ]);

    const duplicate = thrown(() =>
      inviting.issue({ target: "workshop-4", inviter: "Cy", invitee: "Bo", at: instant(1) }),
    );
    expect(duplicate).toBeInstanceOf(InvitationAlreadyPending);
    expect((duplicate as Error).message).toBe(
      "This person already has a pending invitation for the target.",
    );

    const wrongInvitee = thrown(() =>
      inviting.accept({ invitation: "accepted", invitee: "Cy", at: instant(2) }),
    );
    expect(wrongInvitee).toBeInstanceOf(InvitationNotPendingForInvitee);
    expect((wrongInvitee as Error).message).toBe(
      "There is no such pending invitation for this invitee.",
    );
    expect(inviting._get({ invitation: "accepted" })[0]?.status).toBe("pending");
    const wrongInviter = thrown(() =>
      inviting.revoke({ invitation: "accepted", inviter: "Cy", at: instant(2) }),
    );
    expect(wrongInviter).toBeInstanceOf(InvitationNotPendingForInviter);
    expect((wrongInviter as Error).message).toBe(
      "There is no such pending invitation for this inviter.",
    );
    expect(inviting._get({ invitation: "accepted" })[0]?.status).toBe("pending");

    expect(inviting.accept({ invitation: "accepted", invitee: "Bo", at: instant(3) })).toEqual({
      invitation: "accepted",
    });
    expect(inviting._get({ invitation: "accepted" })).toEqual([
      {
        target: "workshop-4",
        inviter: "Ari",
        invitee: "Bo",
        status: "accepted",
        issuedAt: instant(0),
        decidedAt: instant(3),
      },
    ]);
    expect(inviting._pendingFor({ invitee: "Bo" })).toEqual([]);
    expect(
      thrown(() => inviting.accept({ invitation: "accepted", invitee: "Bo", at: instant(4) })),
    ).toBeInstanceOf(InvitationNotPendingForInvitee);
    const lateRevoke = thrown(() =>
      inviting.revoke({ invitation: "accepted", inviter: "Ari", at: instant(4) }),
    );
    expect(lateRevoke).toBeInstanceOf(InvitationNotPendingForInviter);
    expect((lateRevoke as Error).message).toBe(
      "There is no such pending invitation for this inviter.",
    );

    inviting.issue({ target: "workshop-4", inviter: "Ari", invitee: "Bo", at: instant(5) });
    inviting.decline({ invitation: "declined", invitee: "Bo", at: instant(6) });
    expect(
      inviting.issue({ target: "workshop-4", inviter: "Ari", invitee: "Bo", at: instant(7) }),
    ).toEqual({ invitation: "after-decline" });
    inviting.revoke({ invitation: "after-decline", inviter: "Ari", at: instant(8) });
    expect(
      inviting.issue({ target: "workshop-4", inviter: "Ari", invitee: "Bo", at: instant(9) }),
    ).toEqual({ invitation: "revoked" });
    expect(inviting._get({ invitation: "missing" })).toEqual([]);
  });

  test("orders pending invitations by time and then identity", () => {
    const ids = ["invitation-z", "invitation-b", "invitation-a"];
    const inviting = new InvitingMemoryConcept(() => ids.shift() ?? "unexpected");
    inviting.issue({ target: "third", inviter: "A", invitee: "Bo", at: instant(2) });
    inviting.issue({ target: "first", inviter: "B", invitee: "Bo", at: instant(1) });
    inviting.issue({ target: "second", inviter: "C", invitee: "Bo", at: instant(2) });
    expect(inviting._pendingFor({ invitee: "Bo" }).map(({ invitation }) => invitation)).toEqual([
      "invitation-b",
      "invitation-a",
      "invitation-z",
    ]);
  });

  test("allows only one winner in competing issues and decisions", async () => {
    const issueIDs = ["invitation-a", "invitation-b"];
    const issuing = new InvitingMemoryConcept(() => issueIDs.shift() ?? "unexpected");
    const issues = await Promise.allSettled([
      Promise.resolve().then(() =>
        issuing.issue({ target: "workshop", inviter: "Ari", invitee: "Bo", at: instant(0) }),
      ),
      Promise.resolve().then(() =>
        issuing.issue({ target: "workshop", inviter: "Cy", invitee: "Bo", at: instant(0) }),
      ),
    ]);
    expect(issues.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(rejected(issues)[0]).toBeInstanceOf(InvitationAlreadyPending);

    const transitionIDs = ["accept-revoke", "accept-decline"];
    const transitions = new InvitingMemoryConcept(() => transitionIDs.shift() ?? "unexpected");
    transitions.issue({ target: "one", inviter: "Ari", invitee: "Bo", at: instant(0) });
    const acceptRevoke = await Promise.allSettled([
      Promise.resolve().then(() =>
        transitions.accept({ invitation: "accept-revoke", invitee: "Bo", at: instant(1) }),
      ),
      Promise.resolve().then(() =>
        transitions.revoke({ invitation: "accept-revoke", inviter: "Ari", at: instant(1) }),
      ),
    ]);
    expect(acceptRevoke.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(rejected(acceptRevoke)).toHaveLength(1);

    transitions.issue({ target: "two", inviter: "Ari", invitee: "Bo", at: instant(2) });
    const acceptDecline = await Promise.allSettled([
      Promise.resolve().then(() =>
        transitions.accept({ invitation: "accept-decline", invitee: "Bo", at: instant(3) }),
      ),
      Promise.resolve().then(() =>
        transitions.decline({ invitation: "accept-decline", invitee: "Bo", at: instant(3) }),
      ),
    ]);
    expect(acceptDecline.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(rejected(acceptDecline)[0]).toBeInstanceOf(InvitationNotPendingForInvitee);
  });
});
