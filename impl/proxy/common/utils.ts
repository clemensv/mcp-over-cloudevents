import { VERSION } from "./version.js";

/**
 * Utility functions for the MCP CloudEvents Proxy
 */

/**
 * Builds a URL with query parameters
 */
export function buildUrl(baseUrl: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.append(key, value.toString());
    }
  });
  return url.toString();
}

/**
 * User agent string for the proxy
 */
export const USER_AGENT = `mcp-cloudevents-proxy/v${VERSION} (node)`;

/**
 * Parse CloudEvent correlation ID from various formats
 */
export function parseCorrelationId(event: any): string | undefined {
  // Check standard CloudEvents extension attribute
  if (typeof event.correlationid === 'string') {
    return event.correlationid;
  }
  
  // Check camelCase variant
  if (typeof event.correlationId === 'string') {
    return event.correlationId;
  }
  
  // Check data field which might contain a request ID reference
  if (event.data && typeof event.data.requestId === 'string') {
    return event.data.requestId;
  }
  
  return undefined;
}

/**
 * Helper to safely parse JSON
 */
export function safeParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch (e) {
    return undefined;
  }
}