import OpenAI from "openai";

export const OPENAI_MODEL = "gpt-5.6-terra" as const;

export type AiProvider = "openai" | "deterministic-fallback";

export interface AiResult<T> {
  data: T;
  provider: AiProvider;
  model: typeof OPENAI_MODEL;
  warning?: string;
}

/**
 * Creates a short-lived server-side client. The application deliberately uses the
 * project-specific OPENAI_TOKEN name instead of the SDK's default environment key.
 * This module never logs or returns the credential.
 */
export function createOpenAiClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_TOKEN?.trim();

  if (!apiKey) {
    return null;
  }

  return new OpenAI({
    apiKey,
    maxRetries: 1,
    timeout: 45_000,
  });
}
