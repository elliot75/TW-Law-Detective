"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  buildModelPrompt,
  hasOverturnedUpperCourt,
  legalExplanationJsonSchema,
  LegalExplanationSchema,
  MODEL_SYSTEM_PROMPT,
  parseModelJson,
  TLRBundleSchema,
  validateExplanation,
  type LegalExplanation,
  type TLRBundle,
} from "@/lib/contracts";
import { PROVIDERS, type ProviderDefinition } from "@/lib/providers";

const TLR_BASE_URL =
  process.env.NEXT_PUBLIC_TLR_BASE_URL ?? "https://tlr.dr-lawbot.com";
const AI_PREFERENCES_KEY = "tw-law-detective.ai-preferences.v1";
const EXAMPLES = [
  "房東說牆面有刮痕，不願退還租屋押金",
  "公司沒有給加班費，我應該準備哪些證據？",
  "車禍對方主要肇責，我可以主張哪些損害？",
];

type AiPreferences = {
  providerId: ProviderDefinition["id"];
  serverModelId: string;
  customModelId: string;
  customBaseUrl: string;
};

const DEFAULT_AI_PREFERENCES: AiPreferences = {
  providerId: "openai",
  serverModelId: "gpt-5.6-terra",
  customModelId: "",
  customBaseUrl: "",
};

function loadAiPreferences(): AiPreferences {
  if (typeof window === "undefined") return DEFAULT_AI_PREFERENCES;

  try {
    const stored = window.localStorage.getItem(AI_PREFERENCES_KEY);
    if (!stored) return DEFAULT_AI_PREFERENCES;
    const value = JSON.parse(stored) as Partial<AiPreferences>;
    const providerId = ["openai", "gemini", "custom"].includes(
      value.providerId ?? "",
    )
      ? value.providerId as ProviderDefinition["id"]
      : DEFAULT_AI_PREFERENCES.providerId;
    return {
      providerId,
      serverModelId:
        typeof value.serverModelId === "string"
          ? value.serverModelId
          : DEFAULT_AI_PREFERENCES.serverModelId,
      customModelId:
        typeof value.customModelId === "string" ? value.customModelId : "",
      customBaseUrl:
        typeof value.customBaseUrl === "string" ? value.customBaseUrl : "",
    };
  } catch {
    return DEFAULT_AI_PREFERENCES;
  }
}

function saveAiPreferences(preferences: AiPreferences) {
  try {
    window.localStorage.setItem(AI_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Private browsing or storage policy may disable localStorage.
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_api_key: "API 金鑰無效或沒有使用此模型的權限。",
  provider_rate_limit: "模型供應商目前流量過高，請稍後再試。",
  provider_unavailable: "模型供應商暫時無法使用。",
  provider_timeout: "模型在 60 秒內沒有完成，請稍後再試。",
  unverified_model_output: "AI 回覆未通過引用驗證，因此沒有顯示。",
  unsupported_model: "這個模型目前未啟用。",
  payload_too_large: "判決資料超過可處理大小。",
  no_citable_judgments: "目前沒有可供 AI 引用的判決。",
  missing_api_key: "請輸入 API 金鑰。",
  invalid_request: "送出的資料格式不正確。",
  provider_rejected_request: "模型供應商拒絕了這次請求。",
  invalid_provider_response: "模型供應商回傳了無法解析的內容。",
};

function parseLenientJson(text: string): unknown {
  return JSON.parse(text.replace(/[\u0000-\u001f]/g, " "));
}

function detectSensitiveData(query: string): string[] {
  const warnings: string[] = [];
  if (/\b[A-Z][12]\d{8}\b/i.test(query)) warnings.push("疑似身分證字號");
  if (/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(query)) warnings.push("電子郵件");
  if (/(?:\+?886[-\s]?)?0?9\d{2}[-\s]?\d{3}[-\s]?\d{3}/.test(query)) {
    warnings.push("手機號碼");
  }
  return warnings;
}

function verdictFromListing(listing: string): string | null {
  return listing.match(/判決結果:\s*([^|\n]+)/)?.[1]?.trim() ?? null;
}

function providerError(status: number): string {
  if (status === 401 || status === 403) return ERROR_MESSAGES.invalid_api_key;
  if (status === 429) return ERROR_MESSAGES.provider_rate_limit;
  if (status >= 500) return ERROR_MESSAGES.provider_unavailable;
  return ERROR_MESSAGES.provider_rejected_request;
}

function customChatUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("自訂端點必須使用 HTTP 或 HTTPS。 ");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Base URL 不可包含帳密、查詢參數或片段。 ");
  }
  const path = url.pathname.replace(/\/$/, "");
  url.pathname = path.endsWith("/chat/completions")
    ? path
    : `${path}/chat/completions`;
  return url.toString();
}

async function callCustomProvider(options: {
  baseUrl: string;
  modelId: string;
  apiKey: string;
  bundle: TLRBundle;
}): Promise<LegalExplanation> {
  const endpoint = customChatUrl(options.baseUrl);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: options.modelId,
          messages: [
            { role: "system", content: MODEL_SYSTEM_PROMPT },
            {
              role: "user",
              content: buildModelPrompt(options.bundle, attempt === 1),
            },
          ],
          response_format:
            attempt === 0
              ? {
                  type: "json_schema",
                  json_schema: {
                    name: "legal_explanation",
                    strict: true,
                    schema: legalExplanationJsonSchema,
                  },
                }
              : { type: "json_object" },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (attempt === 0 && response.status === 400) continue;
        throw new Error(providerError(response.status));
      }
      const data = (await response.json()) as {
        choices?: Array<{
          message?: { content?: string | Array<{ text?: string }> };
        }>;
      };
      const rawContent = data.choices?.[0]?.message?.content;
      const text = Array.isArray(rawContent)
        ? rawContent.map((item) => item.text ?? "").join("")
        : rawContent ?? "";
      const candidate = parseModelJson(text);
      return validateExplanation(candidate, options.bundle);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(ERROR_MESSAGES.provider_timeout);
      }
      if (attempt === 1) {
        if (error instanceof Error && error.message) throw error;
        throw new Error(ERROR_MESSAGES.unverified_model_output);
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  throw new Error(ERROR_MESSAGES.unverified_model_output);
}

function CitationLinks({
  ids,
  bundle,
}: {
  ids: string[];
  bundle: TLRBundle;
}) {
  const byId = new Map(bundle.judgments.map((item) => [item.citation_id, item]));
  return (
    <span className="citation-links" aria-label="引用判決">
      {ids.map((id) => {
        const judgment = byId.get(id);
        return (
          <a
            key={id}
            href={`#judgment-${id}`}
            title={judgment?.citation_text ?? id}
            className="citation-pill"
          >
            {id}
          </a>
        );
      })}
    </span>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [bundle, setBundle] = useState<TLRBundle | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [providers, setProviders] = useState<ProviderDefinition[]>(PROVIDERS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [aiPreferences, setAiPreferences] = useState(loadAiPreferences);
  const [apiKeys, setApiKeys] = useState<Record<ProviderDefinition["id"], string>>({
    openai: "",
    gemini: "",
    custom: "",
  });
  const [consented, setConsented] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState("");
  const [explanation, setExplanation] = useState<LegalExplanation | null>(null);
  const [notice, setNotice] = useState("");
  const aiResultRef = useRef<HTMLElement>(null);
  const { providerId, serverModelId, customModelId, customBaseUrl } =
    aiPreferences;
  const modelId = providerId === "custom" ? customModelId : serverModelId;
  const apiKey = apiKeys[providerId];

  const sensitiveWarnings = useMemo(() => detectSensitiveData(query), [query]);
  const selectedProvider =
    providers.find((provider) => provider.id === providerId) ?? providers[0];

  useEffect(() => {
    fetch("/api/providers")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => setProviders(data as ProviderDefinition[]))
      .catch(() => setProviders(PROVIDERS));
  }, []);

  function chooseProvider(nextProviderId: ProviderDefinition["id"]) {
    const nextProvider = providers.find((item) => item.id === nextProviderId);
    setAiPreferences((current) => ({
      ...current,
      providerId: nextProviderId,
      serverModelId:
        nextProviderId === "custom"
          ? current.serverModelId
          : (nextProvider?.models[0]?.id ?? ""),
    }));
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const normalizedQuery = query.trim();
    if (!normalizedQuery || normalizedQuery.length > 1000) return;

    setSearching(true);
    setSearchError("");
    setBundle(null);
    setExplanation(null);
    setExplainError("");
    try {
      const response = await fetch(`${TLR_BASE_URL}/v1/pack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: normalizedQuery,
          max_results: 5,
          read_top: 5,
        }),
      });
      if (!response.ok) {
        if (response.status === 429) throw new Error("查詢次數過多，請稍後再試。 ");
        if (response.status === 503) throw new Error("TLR 檢索服務暫時停止。 ");
        throw new Error("判決檢索失敗，請稍後再試。 ");
      }
      const data = TLRBundleSchema.parse(parseLenientJson(await response.text()));
      setBundle(data);
      if (data.judgments.length === 0) {
        setSearchError("找不到結果。查無不代表裁判不存在，請勿臆測案件內容。 ");
      }
    } catch (error) {
      setSearchError(
        error instanceof Error
          ? error.message
          : "TLR 回應格式不相容，請稍後再試。 ",
      );
    } finally {
      setSearching(false);
    }
  }

  async function copyBundle() {
    if (!bundle) return;
    await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
    setNotice("已複製 Bundle");
    window.setTimeout(() => setNotice(""), 2000);
  }

  function downloadBundle() {
    if (!bundle) return;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "twlegalrag-bundle.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function closeDialog() {
    if (explaining) return;
    setDialogOpen(false);
    setConsented(false);
    setExplainError("");
  }

  async function explain(event: FormEvent) {
    event.preventDefault();
    if (!bundle || !apiKey || !modelId || !consented) return;

    setExplaining(true);
    setExplainError("");
    setExplanation(null);
    try {
      if (providerId === "custom") customChatUrl(customBaseUrl);
      saveAiPreferences(aiPreferences);
      let result: LegalExplanation;
      if (providerId === "custom") {
        result = await callCustomProvider({
          baseUrl: customBaseUrl,
          modelId,
          apiKey,
          bundle,
        });
      } else {
        const response = await fetch("/api/explain", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Provider-API-Key": apiKey,
          },
          body: JSON.stringify({ providerId, modelId, bundle }),
        });
        const data = (await response.json()) as unknown;
        if (!response.ok) {
          const code = (data as { error?: string })?.error ?? "invalid_request";
          throw new Error(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.invalid_request);
        }
        result = LegalExplanationSchema.parse(data);
      }
      result = validateExplanation(result, bundle);
      setExplanation(result);
      setDialogOpen(false);
      window.setTimeout(
        () => aiResultRef.current?.scrollIntoView({ behavior: "smooth" }),
        50,
      );
    } catch (error) {
      setExplainError(
        error instanceof Error
          ? error.message
          : ERROR_MESSAGES.unverified_model_output,
      );
    } finally {
      setExplaining(false);
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="回到首頁">
          <span className="brand-mark" aria-hidden="true">
            法
          </span>
          <span>
            <strong>判決指南針</strong>
            <small>TW Legal RAG Web</small>
          </span>
        </a>
        <div className="header-note">
          <span className="status-dot" aria-hidden="true" />
          研究輔助 · 非法律意見
        </div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow">2,200 萬筆台灣裁判語義檢索</div>
        <h1>
          用你習慣的說法，
          <span>找到法院怎麼看。</span>
        </h1>
        <p className="hero-copy">
          不必懂案號或法律術語。描述你遇到的情況，我們會找出相關判決，並清楚標示每一項來源。
        </p>

        <form className="search-panel" onSubmit={search}>
          <label htmlFor="legal-query">描述你想了解的情況</label>
          <textarea
            id="legal-query"
            value={query}
            onChange={(event) => setQuery(event.target.value.slice(0, 1000))}
            placeholder="例如：租約已經結束，房東卻說牆面有刮痕，不願退還兩個月押金……"
            rows={5}
            required
          />
          <div className="query-meta">
            <span>請先移除姓名、身分證、地址與機密資料</span>
            <span>{query.length} / 1000</span>
          </div>
          {sensitiveWarnings.length > 0 && (
            <div className="privacy-warning" role="alert">
              偵測到{sensitiveWarnings.join("、")}，建議刪除或改寫後再搜尋。
            </div>
          )}
          <div className="search-actions">
            <div className="example-list" aria-label="問題範例">
              {EXAMPLES.map((example) => (
                <button
                  type="button"
                  key={example}
                  onClick={() => setQuery(example)}
                >
                  {example.split("，")[0]}
                </button>
              ))}
            </div>
            <button
              className="primary-button"
              type="submit"
              disabled={searching || !query.trim()}
            >
              {searching ? "正在檢索判決…" : "搜尋相關判決"}
            </button>
          </div>
        </form>

        <p className="data-notice">
          搜尋文字會直接傳送至 TLR，服務方可能記錄文字、時間及 IP
          衍生資訊以分析檢索品質。
        </p>
      </section>

      {searchError && (
        <div className="page-message error" role="alert">
          {searchError}
        </div>
      )}

      {bundle && bundle.judgments.length > 0 && (
        <section className="results-section" aria-labelledby="results-title">
          <div className="section-heading">
            <div>
              <div className="eyebrow">檢索完成</div>
              <h2 id="results-title">與你的問題相關的判決</h2>
              <p>
                共找到 {bundle.judgments.length} 篇；只有標示「可引用」的判決能作為 AI
                解讀依據。
              </p>
            </div>
            <div className="bundle-actions">
              <button type="button" className="secondary-button" onClick={copyBundle}>
                複製 Bundle
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={downloadBundle}
              >
                下載 JSON
              </button>
              <button
                type="button"
                className="primary-button compact"
                onClick={() => setDialogOpen(true)}
                disabled={bundle.allowed_citations.length === 0}
              >
                AI 白話整理
              </button>
            </div>
          </div>

          <div className="judgment-grid">
            {bundle.judgments.map((judgment) => {
              const allowed = bundle.allowed_citations.includes(
                judgment.citation_id,
              );
              const overturned = hasOverturnedUpperCourt(judgment);
              const verdict = verdictFromListing(judgment.listing);
              return (
                <article
                  className="judgment-card"
                  id={`judgment-${judgment.citation_id}`}
                  key={judgment.citation_id}
                >
                  <div className="card-topline">
                    <span className="citation-id">{judgment.citation_id}</span>
                    <span className={allowed ? "authority yes" : "authority no"}>
                      {allowed ? "可引用" : "僅供瀏覽"}
                    </span>
                  </div>
                  <h3>{judgment.citation_text}</h3>
                  <div className="case-meta">
                    <span>{judgment.court_name}</span>
                    <span>{judgment.jdate}</span>
                    {judgment.case_category && <span>{judgment.case_category}</span>}
                    {verdict && <span className="verdict">{verdict}</span>}
                  </div>

                  {overturned ? (
                    <div className="history-alert overturned" role="alert">
                      上級審紀錄顯示主文含「廢棄」，不得視為現行有效見解。
                    </div>
                  ) : (
                    <div className="history-alert">
                      {judgment.case_history?.upper?.length
                        ? `資料庫收錄 ${judgment.case_history.upper.length} 筆上級審紀錄`
                        : "資料庫未收錄上級審紀錄；不代表裁判已確定。"}
                    </div>
                  )}

                  {judgment.cited_articles.length > 0 && (
                    <div className="article-tags">
                      {judgment.cited_articles.slice(0, 6).map((article) => (
                        <span key={article}>{article}</span>
                      ))}
                    </div>
                  )}

                  <details>
                    <summary>閱讀判決理由節錄</summary>
                    <div className="excerpt">{judgment.fulltext_excerpt}</div>
                    {judgment.fulltext_truncated && (
                      <p className="muted">此處僅顯示節錄，請開啟原始判決閱讀全文。</p>
                    )}
                  </details>
                  <a
                    className="source-link"
                    href={judgment.citation_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    開啟原始判決 <span aria-hidden="true">↗</span>
                  </a>
                </article>
              );
            })}
          </div>

          {bundle.unread_candidates.length > 0 && (
            <div className="unread-section">
              <h3>其他可能相關，但尚未讀入理由的判決</h3>
              <p>這些結果不能作為法院見解引用。</p>
              <ul>
                {bundle.unread_candidates.map((candidate) => (
                  <li key={candidate.citation_id}>
                    <strong>{candidate.citation_id}</strong>{" "}
                    {candidate.citation_text ?? "未命名判決"}
                    {candidate.reason ? ` — ${candidate.reason}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {explanation && bundle && (
        <section
          className="ai-section"
          aria-labelledby="ai-title"
          ref={aiResultRef}
        >
          <div className="ai-heading">
            <div>
              <div className="eyebrow">已通過結構與引用白名單檢查</div>
              <h2 id="ai-title">AI 白話整理</h2>
            </div>
            <span className={`sufficiency ${explanation.sufficiency}`}>
              {explanation.sufficiency === "sufficient"
                ? "資料較充分"
                : explanation.sufficiency === "partial"
                  ? "資料部分充分"
                  : "資料不足"}
            </span>
          </div>
          <div className="ai-disclaimer">
            結構驗證通過不代表法律推論正確；請自行核對判決，重要事項應諮詢律師。
          </div>
          <div className="summary-block">
            <h3>初步摘要</h3>
            <p>{explanation.summary}</p>
            <CitationLinks ids={explanation.summaryCitationIds} bundle={bundle} />
          </div>

          <div className="ai-columns">
            <div>
              <h3>法院重視的爭點</h3>
              {explanation.legalIssues.map((item) => (
                <article className="finding" key={`${item.title}-${item.explanation}`}>
                  <h4>{item.title}</h4>
                  <p>{item.explanation}</p>
                  <CitationLinks ids={item.citationIds} bundle={bundle} />
                </article>
              ))}
            </div>
            <div>
              <h3>相關判決比較</h3>
              {explanation.caseComparisons.length ? (
                explanation.caseComparisons.map((item) => (
                  <article className="finding" key={`${item.title}-${item.explanation}`}>
                    <h4>{item.title}</h4>
                    <p>{item.explanation}</p>
                    <CitationLinks ids={item.citationIds} bundle={bundle} />
                  </article>
                ))
              ) : (
                <p className="muted">目前資料不足以進行可靠比較。</p>
              )}
            </div>
          </div>

          <div className="checklist-grid">
            <div>
              <h3>可以先準備的資料</h3>
              <ul className="check-list">
                {explanation.evidenceChecklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>仍不確定的地方</h3>
              <ul className="plain-list">
                {explanation.uncertainties.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>一般性下一步</h3>
              <ol className="number-list">
                {explanation.nextSteps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      )}

      <section className="how-it-works" aria-labelledby="how-title">
        <div>
          <div className="eyebrow">資料怎麼流動</div>
          <h2 id="how-title">查判決與請 AI 解讀，是兩件分開的事。</h2>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div>
              <strong>你的問題直接送到 TLR</strong>
              <p>本站不代理或保存搜尋內容。</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>TLR 回傳可驗證的判決包</strong>
              <p>只有已讀入理由的 J 編號能被引用。</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>你決定是否交給 AI</strong>
              <p>API 金鑰不保存，AI 回覆還要通過引用白名單。</p>
            </div>
          </li>
        </ol>
      </section>

      <footer>
        <p>
          非官方開源介面 · 資料來源：
          <a href="https://github.com/aa0101181514/tw-legal-rag">
            Taiwan Legal RAG
          </a>
        </p>
        <p>本服務僅供判決研究，不取代律師、法院或正式法律意見。</p>
      </footer>

      {dialogOpen && bundle && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={closeDialog}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="dialog-close"
              type="button"
              onClick={closeDialog}
              aria-label="關閉"
            >
              ×
            </button>
            <div className="eyebrow">選配功能</div>
            <h2 id="dialog-title">使用自己的模型金鑰整理判決</h2>
            <p className="dialog-intro">
              Bundle 會送到你選擇的模型供應商。本站不保存金鑰，請確認你接受該供應商的資料政策。
            </p>
            <form onSubmit={explain}>
              <fieldset>
                <legend>選擇供應商</legend>
                <div className="provider-options">
                  {providers.map((provider) => (
                    <label key={provider.id}>
                      <input
                        type="radio"
                        name="provider"
                        value={provider.id}
                        checked={providerId === provider.id}
                        onChange={() => chooseProvider(provider.id)}
                      />
                      <span>
                        <strong>{provider.label}</strong>
                        <small>{provider.description}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {providerId === "custom" ? (
                <>
                  <label className="field-label" htmlFor="custom-base-url">
                    OpenAI-compatible Base URL
                  </label>
                  <input
                    id="custom-base-url"
                    type="url"
                    placeholder="http://localhost:11434/v1"
                    value={customBaseUrl}
                    onChange={(event) =>
                      setAiPreferences((current) => ({
                        ...current,
                        customBaseUrl: event.target.value,
                      }))
                    }
                    required
                  />
                  {customBaseUrl.trim().startsWith("http:") && (
                    <div className="privacy-warning custom-http-warning" role="status">
                      HTTP 會以未加密方式傳送 API 金鑰，請只用於可信任的本機或內網端點。
                    </div>
                  )}
                  <label className="field-label" htmlFor="custom-model">
                    模型 ID
                  </label>
                  <input
                    id="custom-model"
                    value={customModelId}
                    onChange={(event) =>
                      setAiPreferences((current) => ({
                        ...current,
                        customModelId: event.target.value,
                      }))
                    }
                    placeholder="provider-model-name"
                    required
                  />
                </>
              ) : (
                <>
                  <label className="field-label" htmlFor="model-select">
                    模型
                  </label>
                  <select
                    id="model-select"
                    value={serverModelId}
                    onChange={(event) =>
                      setAiPreferences((current) => ({
                        ...current,
                        serverModelId: event.target.value,
                      }))
                    }
                  >
                    {selectedProvider.models.map((model) => (
                      <option value={model.id} key={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <label className="field-label" htmlFor="provider-key">
                API 金鑰
              </label>
              <input
                id="provider-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) =>
                  setApiKeys((current) => ({
                    ...current,
                    [providerId]: event.target.value,
                  }))
                }
                placeholder="本分頁內沿用，不寫入本站儲存空間"
                required
              />
              <p className="credential-note">
                端點、模型與供應商會保存在此瀏覽器；API 金鑰只保留在目前分頁，關閉分頁後清除。
              </p>

              <label className="consent-row">
                <input
                  type="checkbox"
                  checked={consented}
                  onChange={(event) => setConsented(event.target.checked)}
                />
                <span>
                  我了解問題與判決節錄將送至 {selectedProvider.label}
                  ，且 AI 整理不是法律意見。
                </span>
              </label>

              {explainError && (
                <div className="dialog-error" role="alert">
                  {explainError}
                </div>
              )}
              <button
                type="submit"
                className="primary-button dialog-submit"
                disabled={
                  explaining ||
                  !consented ||
                  !apiKey ||
                  !modelId ||
                  (providerId === "custom" && !customBaseUrl)
                }
              >
                {explaining ? "整理與驗證中…" : "同意並開始整理"}
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="toast" aria-live="polite" aria-atomic="true">
        {notice}
      </div>
    </main>
  );
}
