import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/explain/route";
import { validBundle, validExplanation } from "./fixtures";

const originalLlamaBaseUrl = process.env.LLAMA_BASE_URL;

function request(body: unknown, apiKey = "secret-test-key") {
  return new Request("http://localhost/api/explain", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Provider-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  });
}

function openAIResponse(value: unknown) {
  return new Response(
    JSON.stringify({
      output: [
        {
          content: [
            { type: "output_text", text: JSON.stringify(value) },
          ],
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function chatCompletionResponse(value: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(value) } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  delete process.env.LLAMA_BASE_URL;
});

afterEach(() => {
  if (originalLlamaBaseUrl === undefined) {
    delete process.env.LLAMA_BASE_URL;
  } else {
    process.env.LLAMA_BASE_URL = originalLlamaBaseUrl;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/explain", () => {
  it("returns a verified explanation without putting the key in the body", async () => {
    const providerFetch = vi.fn().mockResolvedValue(openAIResponse(validExplanation));
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(
      request({
        providerId: "openai",
        modelId: "gpt-5.6-terra",
        bundle: validBundle,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(validExplanation);
    const init = providerFetch.mock.calls[0][1] as RequestInit;
    expect(String(init.body)).not.toContain("secret-test-key");
    expect((init.headers as Record<string, string>).Authorization).toContain(
      "secret-test-key",
    );
  });

  it("retries once and hides an answer with an invalid citation", async () => {
    const invalid = {
      ...validExplanation,
      summaryCitationIds: ["J9"],
    };
    const providerFetch = vi.fn().mockResolvedValue(openAIResponse(invalid));
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(
      request({
        providerId: "openai",
        modelId: "gpt-5.6-terra",
        bundle: validBundle,
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "unverified_model_output" });
    expect(providerFetch).toHaveBeenCalledTimes(2);
  });

  it("maps provider authentication failures without echoing details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 401 })));
    const response = await POST(
      request({
        providerId: "openai",
        modelId: "gpt-5.6-terra",
        bundle: validBundle,
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_api_key" });
  });

  it("uses only the deployment-configured llama.cpp endpoint", async () => {
    process.env.LLAMA_BASE_URL = "http://100.111.111.99:11441/v1";
    const providerFetch = vi
      .fn()
      .mockResolvedValue(chatCompletionResponse(validExplanation));
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(
      request({
        providerId: "llama",
        modelId: "qwen-local",
        bundle: validBundle,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(validExplanation);
    expect(providerFetch.mock.calls[0][0]).toBe(
      "http://100.111.111.99:11441/v1/chat/completions",
    );
    const init = providerFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "qwen-local",
      response_format: {
        type: "json_schema",
        json_schema: { name: "legal_explanation", strict: true },
      },
    });
    expect(String(init.body)).not.toContain("100.111.111.99");
    expect(String(init.body)).not.toContain("secret-test-key");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-test-key",
    );
  });

  it("rejects llama.cpp when no fixed endpoint is configured", async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(
      request({
        providerId: "llama",
        modelId: "qwen-local",
        bundle: validBundle,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "unsupported_model" });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("rejects a browser-supplied llama.cpp endpoint", async () => {
    process.env.LLAMA_BASE_URL = "http://100.111.111.99:11441/v1";
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await POST(
      request({
        providerId: "llama",
        modelId: "qwen-local",
        baseUrl: "http://attacker.invalid/v1",
        bundle: validBundle,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("rejects oversized requests before reading provider data", async () => {
    const oversized = new Request("http://localhost/api/explain", {
      method: "POST",
      headers: {
        "Content-Length": String(300 * 1024),
        "X-Provider-API-Key": "unused",
      },
      body: "{}",
    });
    const response = await POST(oversized);
    expect(response.status).toBe(413);
  });
});
