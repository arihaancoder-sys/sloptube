import { connection } from "next/server";

export async function GET() {
  await connection();
  const env = process.env;
  return Response.json({
    sha: env["GIT_SHA"] || "dev",
    builtAt: process.env.BUILT_AT ?? null,
  });
}
