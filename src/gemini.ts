import { Msg } from "./store";

const MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-3.8-flash",
];

const API_VERSION = "v1beta";

export type RobotAction = "F" | "B" | "L" | "R" | "S" | null;
export type EmotionTag =
  | "HAPPY"
  | "SAD"
  | "ANGRY"
  | "EXCITED"
  | "SHY"
  | "JEALOUS"
  | "LONELY"
  | "CURIOUS"
  | "CARING";

export type PihuResponse = {
  reply: string;
  emotion: EmotionTag;
  move: RobotAction;
  modelUsed?: string;
};

const VALID_EMOTIONS: EmotionTag[] = [
  "HAPPY",
  "SAD",
  "ANGRY",
  "EXCITED",
  "SHY",
  "JEALOUS",
  "LONELY",
  "CURIOUS",
  "CARING",
];

function requireKey(key: string): string {
  const clean = (key || "").trim();
  if (!clean) {
    throw new Error("Gemini API key missing. Open Settings and save your API key.");
  }
  return clean;
}

function parseStructuredReply(rawText: string, modelUsed?: string): PihuResponse {
  const cleaned = rawText.trim();
  let emotion: EmotionTag = "HAPPY";
  let move: RobotAction = null;
  let reply = cleaned;

  const emoMatch = cleaned.match(/\[EMOTION:\s*([A-Z]+)\]/i);
  if (emoMatch) {
    const candidate = emoMatch[1].toUpperCase() as EmotionTag;
    if (VALID_EMOTIONS.includes(candidate)) {
      emotion = candidate;
    }
    reply = reply.replace(emoMatch[0], "").trim();
  } else {
    const upper = cleaned.toUpperCase();
    for (const emo of VALID_EMOTIONS) {
      if (upper.includes(emo)) {
        emotion = emo;
        break;
      }
    }
  }

  const moveMatch = cleaned.match(/\[MOVE:\s*([FBLRS])\]/i);
  if (moveMatch) {
    move = moveMatch[1].toUpperCase() as RobotAction;
    reply = reply.replace(moveMatch[0], "").trim();
  }

  return {
    reply: reply || "Haan, main sun rahi hoon!",
    emotion,
    move,
    modelUsed,
  };
}

async function callSingleModel(
  model: string,
  apiKey: string,
  payload: Record<string, unknown>,
  timeoutMs: number = 9000
): Promise<PihuResponse> {
  const url = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${model}:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`[${model}] ${msg}`);
    }

    const rawText =
      data?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text || "")
        .join("")
        .trim() || "";

    if (!rawText) {
      throw new Error(`[${model}] Empty reply`);
    }

    return parseStructuredReply(rawText, model);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`[${model}] Timeout`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs top candidate models in parallel and returns the first valid fast response;
 * automatically falls back through remaining candidates if any fail.
 */
async function runWithMultiModelFailover(
  apiKey: string,
  payload: Record<string, unknown>
): Promise<PihuResponse> {
  const cleanKey = requireKey(apiKey);
  const errors: string[] = [];

  // Batch 1: Parallel race across primary models for lowest latency
  const parallelBatch = MODEL_CANDIDATES.slice(0, 3);
  const raceResults = await Promise.allSettled(
    parallelBatch.map((m) => callSingleModel(m, cleanKey, payload, 9000))
  );

  for (const r of raceResults) {
    if (r.status === "fulfilled") {
      return r.value;
    }
    errors.push(r.reason?.message || "Unknown model error");
  }

  // Batch 2: Sequential fallback across any remaining models
  const remainingModels = MODEL_CANDIDATES.slice(3);
  for (const m of remainingModels) {
    try {
      return await callSingleModel(m, cleanKey, payload, 10000);
    } catch (err: any) {
      errors.push(err?.message || `Failed on ${m}`);
    }
  }

  throw new Error(
    `All models failed. Please check API key or connection. (${errors.slice(-2).join(" | ")})`
  );
}

export async function askGeminiStructured(
  apiKey: string,
  prompt: string,
  history: Msg[] = [],
  memory: string = "",
  base64Image?: string
): Promise<PihuResponse> {
  const systemInstruction = [
    "You are Pihu, a fast, expressive, warm AI companion robot with an Arduino UNO + HC-05 + ESP8266 face.",
    "Reply briefly and naturally in Hindi, English, or Hinglish matching the user.",
    "If the user asks to move/drive/turn/stop the robot, include [MOVE:F], [MOVE:B], [MOVE:L], [MOVE:R], or [MOVE:S].",
    "Always end your response with [EMOTION:TAG] where TAG is one of HAPPY, SAD, ANGRY, EXCITED, SHY, JEALOUS, LONELY, CURIOUS, CARING.",
