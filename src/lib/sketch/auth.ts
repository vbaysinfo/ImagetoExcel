/**
 * Lightweight access control for the tool's API routes.
 *
 * - SKETCH_ACCESS_CODE (optional): if set, every analysis/generation request
 *   must send it in the `x-access-code` header. Keeps a public website from
 *   exposing a paid AI endpoint to anyone.
 * - SKETCH_ADMIN_TOKEN: required for template upload/mapping changes. When it
 *   is not set, admin changes are only allowed in local development.
 */
import "server-only";
import { timingSafeEqual } from "node:crypto";
import { SketchError } from "./errors";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function accessCodeRequired(): boolean {
  return Boolean(process.env.SKETCH_ACCESS_CODE);
}

export function checkAccess(request: Request): void {
  const code = process.env.SKETCH_ACCESS_CODE;
  if (!code) return;
  const sent = request.headers.get("x-access-code") ?? "";
  if (!safeEqual(sent, code)) {
    throw new SketchError("ACCESS_DENIED", "The access code is missing or incorrect.", 401);
  }
}

export function checkAdmin(request: Request): void {
  const token = process.env.SKETCH_ADMIN_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV === "production") {
      throw new SketchError(
        "ADMIN_DISABLED",
        "Template administration is disabled. Set SKETCH_ADMIN_TOKEN on the server to enable it.",
        403,
      );
    }
    return;
  }
  const sent = request.headers.get("x-admin-token") ?? "";
  if (!safeEqual(sent, token)) throw new SketchError("ADMIN_DENIED", "The admin token is missing or incorrect.", 401);
}
