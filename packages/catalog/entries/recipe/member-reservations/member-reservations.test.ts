import { assemble } from "@mit-sdg/sync-engine/assembly";
import { describe, expect, test } from "vite-plus/test";
import { applicationConceptSet } from "@catalog/concepts";
import { compositions } from "./member-reservations.ts";

const { CancelMemberReservation, FulfillMemberReservation, ReserveForMember } =
  compositions.Reservations;
const { GetMemberReservations } = compositions.ReservationLists;

type Floor = "memory";
type Instances = ReturnType<(typeof applicationConceptSet)["implementations"]>;
const implementations = applicationConceptSet.implementations as unknown as (
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
  await run(implementations(floor, {}));
}

function value(result: Awaited<ReturnType<ReturnType<typeof assemble>["invoker"]["invoke"]>>) {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value as Record<string, unknown>;
}

for (const floor of ["memory"] as const) {
  describe(`Member Reservations ${floor} floor`, () => {
    test.skipIf(!memoryFloorAvailable)(
      "keeps Reserving authoritative and preserves claimant ownership",
      async () => {
        await withFloor(floor, async (instances) => {
          const application = assemble({
            conceptSet: applicationConceptSet,
            instances: instances as never,
            composition: {
              CancelMemberReservation,
              FulfillMemberReservation,
              GetMemberReservations,
              ReserveForMember,
            },
          });
          const created = await application.concepts.Gathering.create({
            name: "Equipment desk",
            host: "Asha",
          });
          if ("error" in created) throw new Error(created.error);
          const gathering = created.gathering;
          await application.concepts.Gathering.join({ gathering, member: "Bo" });

          const first = value(
            await application.invoker.invoke(
              "/member-reservations/reserve" as never,
              { gathering, resource: "projector", claimant: "Asha" } as never,
            ),
          );
          const reservation = String(first.reservation);

          await expect(
            application.invoker.invoke(
              "/member-reservations/reserve" as never,
              { gathering, resource: "projector", claimant: "Bo" } as never,
            ),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "RESOURCE_UNAVAILABLE" },
          });
          await expect(
            application.invoker.invoke(
              "/member-reservations/cancel" as never,
              { reservation, claimant: "Bo" } as never,
            ),
          ).resolves.toEqual({
            ok: false,
            error: {
              kind: "domain",
              value: "RESERVATION_NOT_ACTIVE_FOR_CLAIMANT",
            },
          });

          await expect(
            application.invoker.invoke(
              "/member-reservations/get" as never,
              { claimant: "Asha" } as never,
            ),
          ).resolves.toMatchObject({
            ok: true,
            value: {
              reservations: [{ reservation, resource: "projector" }],
            },
          });
          await expect(
            application.concepts.Gathering.leave({ gathering, member: "Asha" }),
          ).resolves.not.toHaveProperty("error");
          await expect(
            application.concepts.Gathering._membership({ gathering, member: "Asha" }),
          ).resolves.toEqual({ joined: false });
          await expect(application.concepts.Reserving._get({ reservation })).resolves.toMatchObject(
            [{ claimant: "Asha", status: "active" }],
          );
          await expect(
            application.invoker.invoke(
              "/member-reservations/cancel" as never,
              { reservation, claimant: "Asha" } as never,
            ),
          ).resolves.toMatchObject({ ok: true });

          const second = value(
            await application.invoker.invoke(
              "/member-reservations/reserve" as never,
              { gathering, resource: "projector", claimant: "Bo" } as never,
            ),
          );
          await expect(
            application.invoker.invoke(
              "/member-reservations/fulfill" as never,
              { reservation: String(second.reservation), claimant: "Bo" } as never,
            ),
          ).resolves.toMatchObject({ ok: true });
          await expect(
            application.invoker.invoke(
              "/member-reservations/reserve" as never,
              { gathering, resource: "projector", claimant: "Bo" } as never,
            ),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "RESOURCE_UNAVAILABLE" },
          });

          await expect(
            application.invoker.invoke(
              "/member-reservations/reserve" as never,
              { gathering, resource: "camera", claimant: "Cy" } as never,
            ),
          ).resolves.toEqual({
            ok: false,
            error: { kind: "domain", value: "NOT_A_MEMBER" },
          });
          await expect(
            application.concepts.Reserving._blocking({ resource: "camera" }),
          ).resolves.toEqual([]);
        });
      },
      20_000,
    );
  });
}
