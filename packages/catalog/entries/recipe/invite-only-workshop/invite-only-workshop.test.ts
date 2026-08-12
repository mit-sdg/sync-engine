import { assemble } from "@mit-sdg/sync-engine/assembly";
import { describe, expect, test } from "vite-plus/test";
import { applicationConcepts, vocabulary } from "@catalog/concepts";
import { compositions } from "./invite-only-workshop.ts";

const { AcceptWorkshopInvitation, CreateInviteOnlyWorkshop, RepairAcceptedWorkshopInvitation } =
  compositions.WorkshopMembership;
const {
  DeclineWorkshopInvitation,
  GetWorkshopInvitations,
  IssueWorkshopInvitation,
  RevokeWorkshopInvitation,
} = compositions.InvitationManagement;

type Floor = "memory" | "mongo";
type Instances = ReturnType<(typeof applicationConcepts)["implementations"]>;
interface MongoFloorLease {
  database: unknown;
  close(): Promise<void>;
}
const openMongoFloor = (
  globalThis as typeof globalThis & {
    __catalogMongoFloor?: () => Promise<MongoFloorLease>;
  }
).__catalogMongoFloor;
const implementations = applicationConcepts.implementations as unknown as (
  floor: Floor,
  context: object,
) => Instances;
const memoryFloorAvailable = (() => {
  try {
    implementations("memory", {});
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('floor "memory" is missing')) return false;
    throw error;
  }
})();

async function withFloor(
  floor: Floor,
  run: (instances: Instances) => Promise<void>,
): Promise<void> {
  const lease = floor === "mongo" ? await openMongoFloor?.() : undefined;
  if (floor === "mongo" && lease === undefined) return;
  try {
    await run(implementations(floor, lease === undefined ? {} : { db: lease.database }));
  } finally {
    await lease?.close();
  }
}

function value(result: { ok: true; value: unknown } | { ok: false; error: unknown }) {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value as Record<string, unknown>;
}

const composition = {
  AcceptWorkshopInvitation,
  CreateInviteOnlyWorkshop,
  DeclineWorkshopInvitation,
  GetWorkshopInvitations,
  IssueWorkshopInvitation,
  RepairAcceptedWorkshopInvitation,
  RevokeWorkshopInvitation,
};

for (const floor of ["memory", "mongo"] as const) {
  describe(`Invite-only Workshop ${floor} floor`, () => {
    test.skipIf(
      (floor === "memory" && !memoryFloorAvailable) ||
        (floor === "mongo" && openMongoFloor === undefined),
    )(
      "repairs an accepted invitation after its membership consequence faults",
      async () => {
        await withFloor(floor, async (instances) => {
          const gathering = instances.Gathering as unknown as {
            join(input: { gathering: string; member: string }): unknown;
          };
          const realJoin = gathering.join.bind(gathering);
          let faultNextJoin = false;
          let joinCalls = 0;
          gathering.join = function join(input) {
            joinCalls++;
            if (faultNextJoin) {
              faultNextJoin = false;
              throw new Error("injected join fault");
            }
            return realJoin(input);
          };

          const application = assemble({
            vocabulary,
            instances: instances as never,
            composition,
          });
          const created = value(
            await application.invoker.invoke(
              "/invite-workshops/create" as never,
              { name: "Repair workshop", host: "Asha" } as never,
            ),
          );
          const workshop = String(created.workshop);

          await expect(
            application.invoker.invoke(
              "/invite-workshops/invite" as never,
              { workshop: "missing-workshop", inviter: "Asha", invitee: "Bo" } as never,
            ),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "GATHERING_NOT_FOUND" },
          });

          const issued = value(
            await application.invoker.invoke(
              "/invite-workshops/invite" as never,
              { workshop, inviter: "Asha", invitee: "Bo" } as never,
            ),
          );
          const invitation = String(issued.invitation);
          await expect(
            application.invoker.invoke(
              "/invite-workshops/invitations" as never,
              { invitee: "Bo" } as never,
            ),
          ).resolves.toMatchObject({
            ok: true,
            value: {
              invitations: [{ invitation, workshop, inviter: "Asha" }],
            },
          });

          await expect(
            application.invoker.invoke(
              "/invite-workshops/accept" as never,
              { invitation, invitee: "Cy" } as never,
            ),
          ).resolves.toEqual({
            ok: false,
            error: {
              kind: "domain",
              value: "INVITATION_NOT_PENDING_FOR_INVITEE",
            },
          });
          expect(joinCalls).toBe(0);

          faultNextJoin = true;
          await expect(
            application.invoker.invoke(
              "/invite-workshops/accept" as never,
              { invitation, invitee: "Bo" } as never,
            ),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "framework", code: "INTERNAL_ERROR" },
          });

          await expect(application.concepts.Inviting._get({ invitation })).resolves.toMatchObject([
            { target: workshop, invitee: "Bo", status: "accepted" },
          ]);
          await expect(
            application.concepts.Gathering._membership({
              gathering: workshop,
              member: "Bo",
            }),
          ).resolves.toEqual({ joined: false });
          await expect(
            application.invoker.invoke(
              "/invite-workshops/invitations" as never,
              { invitee: "Bo" } as never,
            ),
          ).resolves.toEqual({ ok: true, value: { invitations: [] } });
          expect(joinCalls).toBe(1);

          await expect(
            application.invoker.invoke(
              "/invite-workshops/repair" as never,
              { invitation, invitee: "Cy" } as never,
            ),
          ).resolves.toEqual({
            ok: false,
            error: {
              kind: "domain",
              value: "ACCEPTED_INVITATION_NOT_FOUND",
            },
          });
          expect(joinCalls).toBe(1);

          await expect(
            application.invoker.invoke(
              "/invite-workshops/repair" as never,
              { invitation, invitee: "Bo" } as never,
            ),
          ).resolves.toEqual({
            ok: true,
            value: { invitation, joined: true },
          });
          await expect(
            application.concepts.Gathering._membership({
              gathering: workshop,
              member: "Bo",
            }),
          ).resolves.toEqual({ joined: true });
          expect(joinCalls).toBe(2);

          await expect(
            application.invoker.invoke(
              "/invite-workshops/repair" as never,
              { invitation, invitee: "Bo" } as never,
            ),
          ).resolves.toEqual({
            ok: true,
            value: { invitation, joined: true },
          });
          expect(joinCalls).toBe(2);
          await expect(application.concepts.Inviting._get({ invitation })).resolves.toMatchObject([
            { status: "accepted" },
          ]);

          const declined = value(
            await application.invoker.invoke(
              "/invite-workshops/invite" as never,
              { workshop, inviter: "Asha", invitee: "Cy" } as never,
            ),
          );
          await expect(
            application.invoker.invoke(
              "/invite-workshops/decline" as never,
              { invitation: String(declined.invitation), invitee: "Cy" } as never,
            ),
          ).resolves.toMatchObject({ ok: true });

          const revoked = value(
            await application.invoker.invoke(
              "/invite-workshops/invite" as never,
              { workshop, inviter: "Asha", invitee: "Di" } as never,
            ),
          );
          await expect(
            application.invoker.invoke(
              "/invite-workshops/revoke" as never,
              { invitation: String(revoked.invitation), inviter: "Asha" } as never,
            ),
          ).resolves.toMatchObject({ ok: true });
        });
      },
      20_000,
    );
  });
}
