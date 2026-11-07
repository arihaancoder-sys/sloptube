// Small helpers the comments routes share.
import { commentsStatus } from "./rules";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const noStore = { "Cache-Control": "no-store" };

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** The JSON body as an object, or null when it is not JSON. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return null;
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export function badRequest() {
  return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
}

/** The result as JSON, with the status its error code calls for. */
export function answer<T extends object>(result: T | { error: string }) {
  if ("error" in result && typeof result.error === "string") {
    return Response.json(result, { status: commentsStatus(result.error), headers: noStore });
  }
  return Response.json(result, { headers: noStore });
}
