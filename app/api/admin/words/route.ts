import { answer, badRequest, readJson } from "@/lib/moderation/http";
import { setWord } from "@/lib/moderation/server";
import { cleanWord, isWord } from "@/lib/moderation/words";

// POST /api/admin/words { word, on } adds (on true) or removes a word from the
// automod list. Admins only: everyone else gets a 404.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || typeof body.word !== "string") return badRequest();
  const word = cleanWord(body.word);
  if (!isWord(word)) return answer({ error: "bad_word" });
  return answer(await setWord(word, body.on !== false));
}
