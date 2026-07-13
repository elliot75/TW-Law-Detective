import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/providers/route";

const originalLlamaBaseUrl = process.env.LLAMA_BASE_URL;

beforeEach(() => {
  delete process.env.LLAMA_BASE_URL;
});

afterEach(() => {
  if (originalLlamaBaseUrl === undefined) {
    delete process.env.LLAMA_BASE_URL;
  } else {
    process.env.LLAMA_BASE_URL = originalLlamaBaseUrl;
  }
});

describe("GET /api/providers", () => {
  it("shows llama.cpp only when a valid fixed endpoint is configured", async () => {
    expect((await GET().json()) as Array<{ id: string }>).not.toContainEqual(
      expect.objectContaining({ id: "llama" }),
    );

    process.env.LLAMA_BASE_URL = "http://100.111.111.99:11441/v1";
    expect((await GET().json()) as Array<{ id: string }>).toContainEqual(
      expect.objectContaining({ id: "llama" }),
    );
  });

  it("does not expose an invalid endpoint configuration", async () => {
    process.env.LLAMA_BASE_URL = "file:///etc/passwd";
    expect((await GET().json()) as Array<{ id: string }>).not.toContainEqual(
      expect.objectContaining({ id: "llama" }),
    );
  });
});
