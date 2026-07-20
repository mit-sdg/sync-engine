/** Import-leaf brands keep read-side predicates from creating value cycles. */
export const WhereOpBrand: unique symbol = Symbol("WhereOpBrand");
export const CountOpBrand: unique symbol = Symbol("CountOpBrand");
export const ClaimBrand: unique symbol = Symbol("ClaimBrand");
export const ViewBlockBrand: unique symbol = Symbol("ViewBlockBrand");
export const LineBrand: unique symbol = Symbol("LineBrand");
export const RelationViewBrand: unique symbol = Symbol("RelationViewBrand");
export const FormerUseBrand: unique symbol = Symbol("FormerUseBrand");
export const ReactionCaseBrand: unique symbol = Symbol("ReactionCaseBrand");
export const ReactionPartitionBrand: unique symbol = Symbol("ReactionPartitionBrand");

export function brand<T extends object>(value: T, marker: symbol): T {
  Object.defineProperty(value, marker, { value: true, enumerable: false });
  return value;
}

export function hasBrand(value: unknown, marker: symbol): value is object {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[marker] === true
  );
}
