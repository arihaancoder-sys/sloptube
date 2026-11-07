// Small helpers the studio routes share.
import { studioStatus } from "./rules";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "no-store" };

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return null;
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export function badRequest() {
  return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
}

export function answer<T extends object>(result: T | { error: string }) {
  if ("error" in result && typeof result.error === "string") {
    return Response.json(result, { status: studioStatus(result.error), headers: noStore });
  }
  return Response.json(result, { headers: noStore });
}

/** This site's origin as the browser sees it, for links stored in the database. */
export function originOf(request: Request): string | null {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  if (!host || !/^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) return null;
  const scheme = proto === "https" || proto === "http" ? proto : new URL(request.url).protocol.replace(":", "");
  return `${scheme}://${host}`;
}
