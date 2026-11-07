// Small helpers the launch routes share.
import { launchStatus } from "./rules";

export { badRequest, isUuid, readJson } from "@/lib/studio/http";

const noStore = { "Cache-Control": "no-store" };

export function answer<T extends object>(result: T | { error: string }) {
  if ("error" in result && typeof result.error === "string") {
    return Response.json(result, { status: launchStatus(result.error), headers: noStore });
  }
  return Response.json(result, { headers: noStore });
}
