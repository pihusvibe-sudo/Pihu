
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
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

async function callModel(
  model: string,
  prompt: string,
  apiKey: string,
  memoryText?: string,
  imageBase64?: string | null
): Promise<StructuredReply> {

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const combinedText = memoryText
    ? `You are Pihu, a friendly Hinglish AI companion.\nMemory/context: ${memoryText}\n\nUser: ${prompt}`
    : `You are Pihu, a friendly Hinglish AI companion.\n\nUser: ${prompt}`;

  const parts: any[] = [{ text: combinedText }];

  if (imageBase64) {
    const cleanB64 = imageBase64.replace(
      /^data:image\/[a-zA-Z0-9+.-]+;base64,/,
      ""
    );

    parts.push({
      inline_data: {
        mime_type: "image/jpeg",
        data: cleanB64,
      },
    });
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 700,
      },
    }),
  });

  if (!res.ok) {
    let detail = "";

    try {
      const errorBody: any = await res.json();
      detail =
        errorBody?.error?.message ||
        errorBody?.message ||
        JSON.stringify(errorBody);
    } catch {
      detail = "";
    }

    throw new Error(
      `${model}: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`
    );
  }

  const data: any = await res.json();

  const candidate = data?.candidates?.[0];

  const raw =
    candidate?.content?.parts
      ?.map((part: any) => part?.text || "")
      .join("")
      .trim() || "";

  if (!raw) {
    const reason =
      candidate?.finishReason ||
      data?.promptFeedback?.blockReason ||
      "No text returned";

    throw new Error(`${model}: empty response (${reason})`);
  }

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);

    const action = (parsed?.action || parsed?.move || "none") as RobotAction;

    return {
      reply:
        typeof parsed?.reply === "string" && parsed.reply.trim()
          ? parsed.reply.trim()
          : cleaned,
      emotion: (parsed?.emotion || "happy") as EmotionTag,
      action,
      move: (parsed?.move || action) as RobotAction,
      modelUsed: model,
    };

  } catch {
    return {
      reply: cleaned,
      emotion: "happy",
      action: "none",
      move: "none",
      modelUsed: model,
    };
  }
}

/**
 * IMPORTANT:
 * Correct parameter order matching App.tsx:
 * askGeminiStructured(apiKey, prompt, messages, memoryText, imageBase64)
 */

export async function askGeminiStructured(
  apiKey: string,
  prompt: string,
  _messages?: any,
  memoryText?: string,
  imageBase64?: string | null
): Promise<StructuredReply> {

  const key = (apiKey || "").trim();

  if (!key) {
    throw new Error(
      "Gemini API key is empty. Open Settings, enter your key, and tap Save API Key."
    );
  }

  const message = (prompt || "").trim();

  if (!message && !imageBase64) {
    throw new Error("Please enter a message or capture an image.");
  }

  const results = await Promise.allSettled(
    MODELS.map((model) =>
      callModel(model, message, key, memoryText, imageBase64)
    )
  );

  const success = results.find(
    (result): result is PromiseFulfilledResult<StructuredReply> =>
      result.status === "fulfilled"
  );

  if (success) return success.value;

  const failures = results
    .filter(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected"
    )
    .map((result) =>
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason)
    );

  throw new Error(
    `Gemini requests failed:\n${failures.join("\n")}`
  );
}
