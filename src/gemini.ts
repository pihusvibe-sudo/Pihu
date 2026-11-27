export type EmotionTag =
  | "neutral" | "happy" | "sad" | "angry" | "surprised" | "thinking" | "excited" | "confused"
  | "NEUTRAL" | "HAPPY" | "SAD" | "ANGRY" | "SURPRISED" | "THINKING" | "EXCITED" | "CONFUSED";

export type RobotAction =
  | "none" | "wave" | "nod" | "shake" | "spin" | "forward" | "backward" | "left" | "right" | "stop"
  | "F" | "B" | "L" | "R" | "S";

export interface StructuredReply {
  reply: string;
  emotion: EmotionTag;
  action: RobotAction;
  move: RobotAction;
  modelUsed?: string;
}

const MODELS = [
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-1.5-flash",
];

async function callModel(
  model: string,
  prompt: string,
  apiKey: string,
  memoryText?: string,
  imageBase64?: string | null
): Promise<StructuredReply> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const combinedText = memoryText ? `Context: ${memoryText}\n\nUser: ${prompt}` : prompt;
  const parts: any[] = [{ text: combinedText }];
  if (imageBase64) {
    const cleanB64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");
    parts.push({ inline_data: { mime_type: "image/jpeg", data: cleanB64 } });
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
    }),
  });
  if (!res.ok) {
    throw new Error(`${model} HTTP ${res.status}`);
  }
  const data: any = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("").trim() || "";
  if (!raw) {
    throw new Error(`${model} empty reply`);
  }
  const cleaned = raw.replace(/^```json\s*|```$/gim, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    const act = (parsed?.action || parsed?.move || "none") as RobotAction;
    return {
      reply: typeof parsed?.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : cleaned,
      emotion: (parsed?.emotion || "happy") as EmotionTag,
      action: act,
      move: act,
      modelUsed: model,
    };
  } catch (_) {
    return { reply: cleaned, emotion: "happy", action: "none", move: "none", modelUsed: model };
  }
}

export async function askGeminiStructured(
  prompt: string,
  apiKey?: string,
  _messages?: any,
  memoryText?: string,
  imageBase64?: string | null
): Promise<StructuredReply> {
  const key = (apiKey || process.env.EXPO_PUBLIC_GEMINI_API_KEY || "").trim();
  if (!key) {
    return {
      reply: "Gemini API key missing hai. Kripya API key set karein.",
      emotion: "confused",
      action: "none",
      move: "none",
      modelUsed: "none",
    };
  }
  try {
    return await Promise.any(MODELS.map((m) => callModel(m, prompt, key, memoryText, imageBase64)));
  } catch (_) {
    throw new Error("All models failed in parallel race.");
  }
}
