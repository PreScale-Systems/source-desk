// Nebius Token Factory client. OpenAI-compatible chat completions in JSON mode.
// Server only: reads NEBIUS_API_KEY and NEBIUS_MODEL inside the request.
import { z } from "zod";

export const TOKEN_FACTORY_URL = "https://api.tokenfactory.nebius.com/v1/chat/completions";
export const DEFAULT_MODEL = "nvidia/Nemotron-3_5-Lightning";
const MAX_RESPONSE_BYTES = 64_000;
const TIMEOUT_MS = 30_000;

export class BodyTooLarge extends Error {}

// Content-Length alone is untrusted. Count streamed bytes before parsing JSON.
export async function readBoundedJson(body: ReadableStream<Uint8Array> | null, maximum: number): Promise<unknown> {
  if (!body) throw new SyntaxError("Missing JSON body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new BodyTooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}

const completionSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    message: z.object({ content: z.string().max(25_000) }),
  })).min(1),
});

export type CompletionResult =
  | { ok: true; content: string; model: string }
  | { ok: false; status: 502 | 503 | 504; error: string };

/** One JSON-mode chat completion. Never throws; never returns the key. */
export async function completeJson(system: string, user: string): Promise<CompletionResult> {
  const apiKey = process.env.NEBIUS_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, status: 503, error: "Nemotron is not configured. Use manual entry or the clearly labelled sample parser." };
  }
  const model = process.env.NEBIUS_MODEL?.trim() || DEFAULT_MODEL;
  try {
    const response = await fetch(TOKEN_FACTORY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 2_000,
        // Extraction needs a direct JSON answer, not a reasoning trace that can
        // consume the output budget before any structured fields are returned.
        chat_template_kwargs: { enable_thinking: false },
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        ok: false,
        status: 502,
        error: response.status === 429
          ? "Nemotron is busy. Try again shortly, or use manual entry."
          : "Nemotron could not process the note. Check the server configuration or use manual entry.",
      };
    }
    const payload = completionSchema.safeParse(await readBoundedJson(response.body, MAX_RESPONSE_BYTES));
    if (!payload.success || payload.data.choices[0].finish_reason === "length") {
      return { ok: false, status: 502, error: "Nemotron returned an incomplete result. Try a shorter note or use manual entry." };
    }
    return { ok: true, content: payload.data.choices[0].message.content, model };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      error: timedOut
        ? "Nemotron timed out. Try again or use manual entry."
        : "Nemotron is unavailable or returned an invalid result. Use manual entry or try again.",
    };
  }
}
