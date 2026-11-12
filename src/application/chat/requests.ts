// An explicit product ID is a structured request, not a semantic recommendation.
export function requestedProductId(text: string): string | undefined {
  return text.match(
    /\b(?:tell me about|details (?:for|of)|show me)\s+(?:the\s+)?product\s+([a-z0-9-]+)\b/i,
  )?.[1];
}
