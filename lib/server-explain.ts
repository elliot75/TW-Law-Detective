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
