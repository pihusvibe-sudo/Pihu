import { Msg } from "./store";

const MODEL = "gemini-2.5-flash";
const BASE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function requireKey(key: string): string {
  const clean = (key || "").trim();
  if (!clean) {
    throw new Error("Gemini API key missing. Open Settings and save your API key.");
  }
  return clean;
}

export async function askGemini(
  apiKey: string,
  prompt: string,
  history: Msg[] = []
): Promise<string> {
  const cleanKey = requireKey(apiKey);

  const contents = [
    ...history.slice(-10).map((m) => ({
      role: m.role === "model" ? "model" : "user",
      parts: [{ text: m.text }],
    })),
    {
      role: "user",
      parts: [{ text: prompt }],
    },
  ];

  const res = await fetch(`${BASE_URL}?key=${encodeURIComponent(cleanKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Gemini request failed (${res.status})`);
  }

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text || "")
      .join("")
      .trim() || "";

  if (!text) {
    throw new Error("Empty reply from Gemini.");
  }
  return text;
}

export async function visionGemini(apiKey: string, base64Image: string): Promise<string> {
  const cleanKey = requireKey(apiKey);

  const res = await fetch(`${BASE_URL}?key=${encodeURIComponent(cleanKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Describe what you see in this camera frame briefly and naturally in Hindi/Hinglish as Pihu, an AI robot friend.",
            },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image,
              },
            },
          ],
        },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Vision request failed (${res.status})`);
  }

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text || "")
      .join("")
      .trim() || "";

  if (!text) {
    throw new Error("Empty vision reply from Gemini.");
  }
  return text;
}
