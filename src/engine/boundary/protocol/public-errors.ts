import type { PublicErrorCategory } from "@engine/reactions/concepts/concept-metadata";
import { FrameworkErrorCode } from "./types.ts";

export const PUBLIC_ERROR_CATEGORIES = {
  INVALID_REQUEST: "INVALID_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
} as const satisfies Record<PublicErrorCategory, PublicErrorCategory>;

function isPublicErrorCategory(value: unknown): value is PublicErrorCategory {
  return typeof value === "string" && Object.hasOwn(PUBLIC_ERROR_CATEGORIES, value);
}

export function registeredPublicCategoryOf(
  code: string,
  categories: Readonly<Record<string, PublicErrorCategory>>,
): PublicErrorCategory | "INTERNAL_ERROR" {
  if (!Object.hasOwn(categories, code)) return "INTERNAL_ERROR";
  const category = categories[code];
  return isPublicErrorCategory(category) ? category : "INTERNAL_ERROR";
}

export function publicFrameworkCategoryOf(code: string): PublicErrorCategory | "INTERNAL_ERROR" {
  switch (code) {
    case FrameworkErrorCode.INVALID_INPUT:
    case FrameworkErrorCode.BAD_JSON:
    case FrameworkErrorCode.BAD_STATUS:
      return "INVALID_REQUEST";
    case FrameworkErrorCode.NOT_FOUND:
      return "NOT_FOUND";
    default:
      return "INTERNAL_ERROR";
  }
}

/** Project a generated error code onto the production HTTP vocabulary. */
export function publicCategoryOf(
  code: string,
  categories: Readonly<Record<string, PublicErrorCategory>>,
): PublicErrorCategory | "INTERNAL_ERROR" {
  return Object.hasOwn(categories, code)
    ? registeredPublicCategoryOf(code, categories)
    : publicFrameworkCategoryOf(code);
}

export function publicErrorStatus(category: PublicErrorCategory | "INTERNAL_ERROR"): number {
  switch (category) {
    case "INVALID_REQUEST":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "INTERNAL_ERROR":
      return 500;
    default:
      return 500;
  }
}
