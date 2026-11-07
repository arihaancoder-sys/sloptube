import { signUpload } from "@/lib/upload/handlers";
import { runUploadRoute } from "@/lib/upload/context";

// See signUpload in lib/upload/handlers.ts for what this route checks and returns.
export async function POST(request: Request) {
  return runUploadRoute(request, signUpload);
}
