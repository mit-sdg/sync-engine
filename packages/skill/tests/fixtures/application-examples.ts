import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { compute, is, where } from "@mit-sdg/sync-engine/language";

const inputs = conceptSet(
  {},
  {
    hasExpiry: ({ expiresAt }: { expiresAt: string | null }) => expiresAt !== null,
    defaultCode: (_input: Record<string, never>) => "generated",
  },
);

export const CreateLink = endpoint(
  "/links",
  ({ expiresAt, hasExpiry, code }) =>
    receive({ expiresAt }).then(
      where(
        compute(inputs.computations.hasExpiry, { expiresAt }, hasExpiry),
        is.among(hasExpiry, [true]),
      )
        .then(respond({ mode: "expiring" }))
        .named("with-expiry"),
      where(
        compute(inputs.computations.hasExpiry, { expiresAt }, hasExpiry),
        is.among(hasExpiry, [false]),
        compute(inputs.computations.defaultCode, {}, code),
      )
        .then(respond({ mode: "permanent", code }))
        .named("without-expiry"),
    ),
  { input: { defaults: { expiresAt: null } } },
);
