import type { PublicErrorCategory } from "@engine/reactions/concepts/concept-metadata";
import { FrameworkErrorCode } from "./errors.ts";

export const PUBLIC_ERROR_CATEGORIES = {
  INVALID_REQUEST: "INVALID_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
} as const satisfies Record<PublicErrorCategory, PublicErrorCategory>;

const publicCategories = new Set<string>(Object.values(PUBLIC_ERROR_CATEGORIES));

/** Project a domain or framework error code onto the HTTP floor's public vocabulary. */
export function publicCategoryOf(
  code: string,
  categories: Readonly<Record<string, PublicErrorCategory>>,
): PublicErrorCategory | "INTERNAL_ERROR" {
  if (publicCategories.has(code)) return code as PublicErrorCategory;
  switch (code) {
    case FrameworkErrorCode.INVALID_INPUT:
    case FrameworkErrorCode.BAD_JSON:
    case FrameworkErrorCode.BAD_STATUS:
      return "INVALID_REQUEST";
    case FrameworkErrorCode.NOT_FOUND:
      return "NOT_FOUND";
    case FrameworkErrorCode.INTERNAL_ERROR:
      return "INTERNAL_ERROR";
    default:
      return categories[code] ?? "INTERNAL_ERROR";
  }
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
  }
}
