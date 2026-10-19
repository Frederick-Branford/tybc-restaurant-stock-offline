import "server-only";

import OpenAI from "openai";

export function createOpenAIClient() {
  const apiKey =
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured.",
    );
  }

  return new OpenAI({
    apiKey,
  });
}

export function getOpenAIModel() {
  return (
    process.env.OPENAI_MODEL ??
    "gpt-6.1-sol"
  );
}