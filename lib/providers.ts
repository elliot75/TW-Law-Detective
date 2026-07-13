export type ProviderDefinition = {
  id: "openai" | "gemini" | "llama" | "custom";
  label: string;
  description: string;
  transport: "server" | "browser";
  models: Array<{ id: string; label: string }>;
};

export const LLAMA_PROVIDER: ProviderDefinition = {
  id: "llama",
  label: "llama.cpp（固定端點）",
  description: "由本站伺服器代送至部署者設定的 llama.cpp 端點。",
  transport: "server",
  models: [],
};

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "Responses API；金鑰僅在本次請求中轉。",
    transport: "server",
    models: [
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra（平衡）" },
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol（高品質）" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna（經濟）" },
    ],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    description: "Gemini 原生 API；金鑰僅在本次請求中轉。",
    transport: "server",
    models: [
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
    ],
  },
  {
    id: "custom",
    label: "自訂相容端點",
    description: "由瀏覽器直連支援 CORS 的 OpenAI-compatible API。",
    transport: "browser",
    models: [],
  },
];

export function getServerProvider(
  providerId: string,
  modelId: string,
  llamaConfigured = false,
): ProviderDefinition | undefined {
  if (providerId === "llama" && llamaConfigured && modelId.length > 0) {
    return LLAMA_PROVIDER;
  }
  return PROVIDERS.find(
    (provider) =>
      provider.id === providerId &&
      provider.transport === "server" &&
      provider.models.some((model) => model.id === modelId),
  );
}
