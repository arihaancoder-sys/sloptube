import { flagPanelOn, panelFlagStates } from "@/lib/flag-panel-server";
import { FlagPanel } from "./FlagPanel";

/**
 * Mounts the flag panel for admins only (feature 17). It reads the request,
 * so it sits behind a Suspense boundary in the root layout and streams in.
 * For everyone else it renders nothing, so Ctrl+Shift+S stays theirs.
 */
export async function FlagPanelGate() {
  const gate = await flagPanelOn();
  if ("error" in gate) return null;
  return <FlagPanel initial={await panelFlagStates(gate.userId)} />;
}
