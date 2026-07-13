import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/providers/route";

const llamaEnvironmentKeys = [
  "LLAMA_BASE_URL",
  "LLAMA_API_KEY",
  "LLAMA_MODEL_IDS",
] as const;
const originalLlamaEnvironment = Object.fromEntries(
  llamaEnvironmentKeys.map((key) => [key, process.env[key]]),
);

beforeEach(() => {
  for (const key of llamaEnvironmentKeys) delete process.env[key];
});

afterEach(() => {
  for (const key of llamaEnvironmentKeys) {
    const value = originalLlamaEnvironment[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("GET /api/providers", () => {
  it("shows llama.cpp only when a valid fixed endpoint is configured", async () => {
    expect((await GET().json()) as Array<{ id: string }>).not.toContainEqual(
      expect.objectContaining({ id: "llama" }),
    );

    process.env.LLAMA_BASE_URL = "http://100.111.111.99:11441/v1";
    process.env.LLAMA_API_KEY = "configured-llama-key";
    process.env.LLAMA_MODEL_IDS = "qwen-local,qwen-fallback";
    expect((await GET().json()) as Array<{ id: string; models: unknown }>).toContainEqual(
      expect.objectContaining({
        id: "llama",
        models: [
          { id: "qwen-local", label: "qwen-local" },
          { id: "qwen-fallback", label: "qwen-fallback" },
        ],
      }),
    );
  });

  it("does not expose an invalid endpoint configuration", async () => {
    process.env.LLAMA_BASE_URL = "file:///etc/passwd";
    expect((await GET().json()) as Array<{ id: string }>).not.toContainEqual(
      expect.objectContaining({ id: "llama" }),
    );
  });
});
