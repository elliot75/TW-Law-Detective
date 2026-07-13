import {
  buildModelPrompt,
  legalExplanationJsonSchema,
  MODEL_SYSTEM_PROMPT,
  parseModelJson,
  type TLRBundle,
} from "@/lib/contracts";

export class ProviderRequestError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "ProviderRequestError";
    this.code = code;
    this.status = status;
  }
}

function mapProviderStatus(status: number): ProviderRequestError {
  if (status === 401 || status === 403) {
    return new ProviderRequestError("invalid_api_key", 401);
  }
  if (status === 429) {
    return new ProviderRequestError("provider_rate_limit", 429);
  }
  if (status >= 500) {
    return new ProviderRequestError("provider_unavailable", 502);
  }
  return new ProviderRequestError("provider_rejected_request", 400);
}

function extractOpenAIText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const response = data as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (response.output_text) return response.output_text;
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

function extractChatCompletionText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const response = data as {
    choices?: Array<{
      message?: { content?: string | Array<{ text?: string }> };
    }>;
  };
  const content = response.choices?.[0]?.message?.content;
  return Array.isArray(content)
    ? content.map((item) => item.text ?? "").join("")
    : (content ?? "");
}

export type LlamaConfiguration = {
  endpoint: string;
  apiKey: string;
  models: Array<{ id: string; label: string }>;
};

export function getLlamaChatEndpoint(): string | null {
  const baseUrl = process.env.LLAMA_BASE_URL?.trim();
  if (!baseUrl) return null;

  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    const path = url.pathname.replace(/\/$/, "");
    url.pathname = path.endsWith("/chat/completions")
      ? path
      : `${path}/chat/completions`;
    return url.toString();
  } catch {
    return null;
  }
}

function getLlamaModels(): Array<{ id: string; label: string }> {
  const modelIds = (process.env.LLAMA_MODEL_IDS ?? "")
    .split(",")
    .map((modelId) => modelId.trim())
    .filter((modelId) => modelId.length > 0 && modelId.length <= 120);
  return [...new Set(modelIds)].slice(0, 20).map((id) => ({ id, label: id }));
}

export function getLlamaConfiguration(): LlamaConfiguration | null {
  const endpoint = getLlamaChatEndpoint();
  const apiKey = process.env.LLAMA_API_KEY?.trim();
  const models = getLlamaModels();
  if (!endpoint || !apiKey || apiKey.length > 512 || models.length === 0) {
    return null;
  }
  return { endpoint, apiKey, models };
}

export async function callOpenAI(
  apiKey: string,
  modelId: string,
  bundle: TLRBundle,
  correction: boolean,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      input: [
        { role: "system", content: MODEL_SYSTEM_PROMPT },
        { role: "user", content: buildModelPrompt(bundle, correction) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "legal_explanation",
          strict: true,
          schema: legalExplanationJsonSchema,
        },
      },
      max_output_tokens: 5000,
    }),
    signal,
  });

  if (!response.ok) throw mapProviderStatus(response.status);
  const text = extractOpenAIText(await response.json());
  if (!text) throw new ProviderRequestError("invalid_provider_response", 502);
  return parseModelJson(text);
}

export async function callGemini(
  apiKey: string,
  modelId: string,
  bundle: TLRBundle,
  correction: boolean,
  signal: AbortSignal,
): Promise<unknown> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: MODEL_SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [{ text: buildModelPrompt(bundle, correction) }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: legalExplanationJsonSchema,
        maxOutputTokens: 5000,
      },
    }),
    signal,
  });

  if (!response.ok) throw mapProviderStatus(response.status);
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("");
  if (!text) throw new ProviderRequestError("invalid_provider_response", 502);
  return parseModelJson(text);
}

export async function callLlama(
  endpoint: string,
  apiKey: string,
  modelId: string,
  bundle: TLRBundle,
  correction: boolean,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: MODEL_SYSTEM_PROMPT },
          { role: "user", content: buildModelPrompt(bundle, correction) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "legal_explanation",
            strict: true,
            schema: legalExplanationJsonSchema,
          },
        },
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ProviderRequestError("provider_unavailable", 502);
  }

  if (!response.ok) throw mapProviderStatus(response.status);
  const text = extractChatCompletionText(await response.json());
  if (!text) throw new ProviderRequestError("invalid_provider_response", 502);
  return parseModelJson(text);
}
