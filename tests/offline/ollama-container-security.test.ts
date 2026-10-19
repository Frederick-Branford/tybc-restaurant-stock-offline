import { describe, expect, it } from "vitest";

import { readLocalAiConfig } from "@/lib/ai/providers/ollama";

const ENABLED_ENV = {
  AI_LOCAL_ENABLED: "true",
} as const;

describe("offline container Ollama security boundary", () => {
  it("allows the exact Docker Desktop host bridge only in offline container mode", () => {
    const result = readLocalAiConfig({
      ...ENABLED_ENV,
      TYBC_OFFLINE_CONTAINER: "true",
      OLLAMA_BASE_URL: "http://host.docker.internal:11434",
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.config.baseUrl).toBe(
        "http://host.docker.internal:11434",
      );

      expect(result.config.chatUrl).toBe(
        "http://host.docker.internal:11434/api/chat",
      );
    }
  });

  it.each([
    {
      name: "host bridge without offline container flag",
      env: {
        ...ENABLED_ENV,
        OLLAMA_BASE_URL: "http://host.docker.internal:11434",
      },
    },
    {
      name: "host bridge on the wrong port",
      env: {
        ...ENABLED_ENV,
        TYBC_OFFLINE_CONTAINER: "true",
        OLLAMA_BASE_URL: "http://host.docker.internal:11435",
      },
    },
    {
      name: "LAN IPv4 address even with offline flag",
      env: {
        ...ENABLED_ENV,
        TYBC_OFFLINE_CONTAINER: "true",
        OLLAMA_BASE_URL: "http://192.168.1.20:11434",
      },
    },
    {
      name: "private IPv4 address even with offline flag",
      env: {
        ...ENABLED_ENV,
        TYBC_OFFLINE_CONTAINER: "true",
        OLLAMA_BASE_URL: "http://10.0.0.5:11434",
      },
    },
    {
      name: "public hostname even with offline flag",
      env: {
        ...ENABLED_ENV,
        TYBC_OFFLINE_CONTAINER: "true",
        OLLAMA_BASE_URL: "http://ollama.example.com:11434",
      },
    },
  ])("rejects $name", ({ env }) => {
    expect(readLocalAiConfig(env)).toEqual({
      ok: false,
      error: {
        code: "LOCAL_AI_CONFIGURATION_ERROR",
        reason: "NON_LOOPBACK_HOST",
      },
    });
  });
});
