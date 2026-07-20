import type { InputContractDecl } from "./endpoints.ts";

/**
 * The application facts a gateway may rely on. It deliberately contains no
 * concepts, reactions, engine instance, or transport details.
 */
export interface ApplicationInterface {
  readonly routes: Readonly<Record<string, InputContractDecl>>;
}
