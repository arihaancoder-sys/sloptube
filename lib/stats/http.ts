// Small helpers the analytics routes share.
import { RANGES, statsStatus, type Range } from "./rules";

const noStore = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function badRequest() {
  return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
}

/** ?range=: one of the four, the default when missing, null when it is something else. */
export function rangeParam(url: URL): Range | null {
  const v = url.searchParams.get("range");
  if (v === null || v === "") return "28d";
  return (RANGES as readonly string[]).includes(v) ? (v as Range) : null;
}

/** A video id from the query, lower case, or null. */
export function idParam(url: URL, name: string): string | null {
  const v = url.searchParams.get(name);
  return v && UUID.test(v) ? v.toLowerCase() : null;
}

export function answer<T extends object>(result: T | { error: string }) {
  if ("error" in result && typeof result.error === "string") {
    const status = statsStatus(result.error);
    return Response.json(result, { status, headers: status === 429 ? { ...noStore, "Retry-After": "60" } : noStore });
  }
  return Response.json(result, { headers: noStore });
}
