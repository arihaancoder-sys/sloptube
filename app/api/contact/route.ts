import { answer, badRequest, readJson } from "@/lib/launch/http";
import { contactProblem } from "@/lib/launch/rules";
import { sendContact } from "@/lib/launch/server";

// POST /api/contact { name, email, topic, body } answers { id }. With the
// launch flag on, 5 a day per email address and per network address. See
// contact_send in 017_launch.sql.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return badRequest();
  const input = {
    name: typeof body.name === "string" ? body.name : "",
    email: typeof body.email === "string" ? body.email : "",
    topic: typeof body.topic === "string" ? body.topic : "general",
    body: typeof body.body === "string" ? body.body : "",
  };
  const problem = contactProblem(input);
  if (problem) return answer({ error: problem });
  return answer(await sendContact(input));
}
