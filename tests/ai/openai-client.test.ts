import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createOpenAIClient,
  getOpenAIModel,
} from "@/lib/ai/openai";

const mocks = vi.hoisted(() => ({
  openAIConstructor: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor(options: unknown) {
      mocks.openAIConstructor(options);
    }
  },
}));

describe("src/lib/ai/openai.ts (characterization)", () => {
  beforeEach(() => {
    mocks.openAIConstructor.mockReset();
  });

  it("uses gpt-6.1-sol when OPENAI_MODEL is not set", () => {
    expect(getOpenAIModel()).toBe("gpt-6.1-sol");
  });

  it("uses OPENAI_MODEL when it is set", () => {
    vi.stubEnv("OPENAI_MODEL", "test-model");

    expect(getOpenAIModel()).toBe("test-model");
  });

  it("throws when OPENAI_API_KEY is not configured", () => {
    expect(() => createOpenAIClient()).toThrow(
      "OPENAI_API_KEY is not configured.",
    );

    expect(mocks.openAIConstructor).not.toHaveBeenCalled();
  });

  it("passes only the API key to the OpenAI SDK", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key-not-real");

    createOpenAIClient();

    expect(mocks.openAIConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.openAIConstructor).toHaveBeenCalledWith({
      apiKey: "test-openai-key-not-real",
    });
  });
});
