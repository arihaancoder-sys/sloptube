import { yapinStatus } from "@/lib/yapin/rules";
import { unlinkYapin } from "@/lib/yapin/server";

const noStore = { "Cache-Control": "no-store" };

// POST /api/yapin/unlink answers { ok: true }: Settings > Connections removes
// the caller's Yapin' link (unlink_yapin in 018). 503 yapin_off while the flag
// is off or the Yapin' app is not set on the server.
export async function POST() {
  const result = await unlinkYapin();
  if ("error" in result) return Response.json(result, { status: yapinStatus(result.error), headers: noStore });
  return Response.json(result, { headers: noStore });
}
