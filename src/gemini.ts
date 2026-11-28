
export type EmotionTag =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "surprised"
  | "thinking"
  | "excited"
  | "confused"
  | "shy"
  | "jealous"
  | "lonely"
  | "curious"
  | "caring"
  | "NEUTRAL"
  | "HAPPY"
  | "SAD"
  | "ANGRY"
  | "SURPRISED"
  | "THINKING"
  | "EXCITED"
  | "CONFUSED"
  | "SHY"
  | "JEALOUS"
  | "LONELY"
  | "CURIOUS"
  | "CARING";

export type RobotAction =
  | "none"
  | "wave"
  | "nod"
  | "shake"
  | "spin"
  | "forward"
  | "backward"
  | "left"
  | "right"
  | "stop"
  | "F"
  | "B"
  | "L"
  | "R"
  | "S";

export interface StructuredReply {
  reply: string;
  emotion: EmotionTag;
  action: RobotAction;
  move: RobotAction;
  modelUsed?: string;
}

const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
];

const GROQ_MODEL = "openai/gpt-oss-20b";

const REQUEST_TIMEOUT = 28000;

const VALID_EMOTIONS = [
  "neutral", "happy", "sad", "angry",
  "surprised", "thinking", "excited", "confused",
  "shy", "jealous", "lonely", "curious", "caring",
];

const VALID_ACTIONS = [
  "none", "wave", "nod", "shake", "spin",
  "forward", "backward", "left", "right", "stop",
  "F", "B", "L", "R", "S",
];

const SYSTEM_PROMPT = `
You are Pihu, a friendly, emotionally expressive AI companion.

Speak naturally in Hinglish (Hindi + English).
Be warm, caring, playful and conversational.

Return ONLY valid JSON in this exact structure:

{
  "reply": "Your natural response",
  "emotion": "happy",
  "action": "none",
  "move": "none"
}

Allowed emotions:
neutral, happy, sad, angry, surprised, thinking,
excited, confused, shy, jealous, lonely, curious, caring.

Allowed actions:
none, wave, nod, shake, spin, forward, backward,
left, right, stop, F, B, L, R, S.

Do not include Markdown fences.
Do not invent hardware commands.
`;

function normalizeEmotion(value: any): EmotionTag {
  const emotion = String(value || "happy").toLowerCase();

  return VALID_EMOTIONS.includes(emotion)
    ? emotion as EmotionTag
    : "happy";
}

function normalizeAction(value: any): RobotAction {
  const action = String(value || "none");

  return VALID_ACTIONS.includes(action)
    ? action as RobotAction
    : "none";
}

function parseReply(
  raw: string,
  modelUsed: string
): StructuredReply {
  if (!raw || !raw.trim()) {
    throw new Error("Empty AI response");
  }

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);

    if (
      typeof parsed.reply !== "string" ||
      !parsed.reply.trim()
    ) {
      throw new Error("Missing reply field");
    }

    const action = normalizeAction(
      parsed.action || parsed.move
    );

    return {
      reply: parsed.reply.trim(),
      emotion: normalizeEmotion(parsed.emotion),
      action,
      move: normalizeAction(parsed.move || action),
      modelUsed,
    };
  } catch (error) {
    // Plain text is not accepted as a valid winner.
    throw new Error(
      `Invalid structured response: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function buildHistory(messages: any[] = []) {
  return messages
    .filter(
      (message) =>
        message &&
        typeof message.text === "string" &&
        message.text.trim()
    )
    .slice(-12)
    .map((message) => ({
      role: message.role === "model" ? "model" : "user",
      parts: [{ text: message.text }],
    }));
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  controller: AbortController
): Promise<Response> {
  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body: any = await response.json();

    return (
      body?.error?.message ||
      body?.message ||
      JSON.stringify(body)
    );
  } catch {
    return `HTTP ${response.status}`;
  }
}

// GEMINI PROVIDER
async function callGemini(
  model: string,
  prompt: string,
  apiKey: string,
  messages: any[],
  memoryText?: string,
  imageBase64?: string | null,
  controller?: AbortController
): Promise<StructuredReply> {
  if (!controller) {
    throw new Error("Gemini request controller missing");
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const context = memoryText
    ? `Personal memory:\n${memoryText}\n\n`
    : "";

  const history = buildHistory(messages);

  const parts: any[] = [
    {
      text:
        `${SYSTEM_PROMPT}\n\n${context}` +
        `Current user message:\n${prompt}`,
    },
  ];

  if (imageBase64) {
    const cleanImage = imageBase64.replace(
      /^data:image\/[a-zA-Z0-9+.-]+;base64,/,
      ""
    );

    parts.push({
      inline_data: {
        mime_type: "image/jpeg",
        data: cleanImage,
      },
    });
  }

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          ...history,
          { role: "user", parts },
        ],
        generationConfig: {
          maxOutputTokens: 700,
          responseMimeType: "application/json",
        },
      }),
    },
    controller
  );

  if (!response.ok) {
    throw new Error(
      `Gemini ${model}: ${await readError(response)}`
    );
  }

  const data: any = await response.json();

  const raw = data?.candidates?.[0]?.content?.parts
    ?.map((part: any) => part.text || "")
    .join("")
    .trim();

  return parseReply(raw, `Gemini/${model}`);
}

// GROQ PROVIDER
async function callGroq(
  apiKey: string,
  prompt: string,
  messages: any[],
  memoryText?: string,
  controller?: AbortController
): Promise<StructuredReply> {
  if (!controller) {
    throw new Error("Groq request controller missing");
  }

  const history = messages
    .filter(
      (message) =>
        message &&
        typeof message.text === "string" &&
        message.text.trim()
    )
    .slice(-12)
    .map((message) => ({
      role: message.role === "model" ? "assistant" : "user",
      content: message.text,
    }));

  const systemContent = memoryText
    ? `${SYSTEM_PROMPT}\n\nPersonal memory:\n${memoryText}`
    : SYSTEM_PROMPT;

  const response = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content: systemContent,
          },
          ...history,
          {
            role: "user",
            content: prompt,
          },
        ],
        max_completion_tokens: 700,
        response_format: {
          type: "json_object",
        },
      }),
    },
    controller
  );

  if (!response.ok) {
    throw new Error(
      `Groq ${GROQ_MODEL}: ${await readError(response)}`
    );
  }

  const data: any = await response.json();

  const raw =
    data?.choices?.[0]?.message?.content || "";

  return parseReply(raw, `Groq/${GROQ_MODEL}`);
}

// BADSAH-STYLE FIRST VALID WINNER ENGINE
export async function askGeminiStructured(
  apiKey: string,
  prompt: string,
  messages: any[] = [],
  memoryText?: string,
  imageBase64?: string | null,
  groqApiKey?: string
): Promise<StructuredReply> {
  const geminiKey = (apiKey || "").trim();
  const groqKey = (groqApiKey || "").trim();

  if (!geminiKey && !groqKey) {
    throw new Error(
      "No AI provider configured. Add a Gemini or Groq API key in Settings."
    );
  }

  if (!prompt.trim() && !imageBase64) {
    throw new Error("Message is empty.");
  }

  if (imageBase64 && !geminiKey) {
    throw new Error(
      "Camera vision requires a Gemini API key. Add Gemini in Settings."
    );
  }

  const controllers: AbortController[] = [];
  const tasks: Promise<StructuredReply>[] = [];

  if (geminiKey) {
    for (const model of GEMINI_MODELS) {
      const controller = new AbortController();
      controllers.push(controller);

      tasks.push(
        callGemini(
          model,
          prompt,
          geminiKey,
          messages,
          memoryText,
          imageBase64,
          controller
        )
      );
    }
  }

  // Groq GPT OSS 20B is used for text requests.
  // Do not send camera image data to this text-only path.
  if (groqKey && !imageBase64) {
    const controller = new AbortController();
    controllers.push(controller);

    tasks.push(
      callGroq(
        groqKey,
        prompt,
        messages,
        memoryText,
        controller
      )
    );
  }

  try {
    // First successful, validated response wins.
    const winner = await Promise.any(tasks);

    // Stop unnecessary requests where supported.
    controllers.forEach((controller) => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    });

    return winner;
  } catch (error: any) {
    const failures = Array.isArray(error?.errors)
      ? error.errors.map((item: any) =>
          item instanceof Error ? item.message : String(item)
        )
      : [String(error)];

    throw new Error(
      `All AI providers failed:\n${failures.join("\n")}`
    );
  }
}
