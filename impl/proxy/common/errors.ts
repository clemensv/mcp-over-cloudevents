// Basic error classes for MCP CloudEvents Proxy
export class MCPError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MCPError";
  }
}

export class ConnectionError extends MCPError {
  constructor(message: string) {
    super(`Connection error: ${message}`);
    this.name = "ConnectionError";
  }
}

export class TransportError extends MCPError {
  constructor(message: string) {
    super(`Transport error: ${message}`);
    this.name = "TransportError";
  }
}

export class ProtocolError extends MCPError {
  constructor(message: string) {
    super(`Protocol error: ${message}`);
    this.name = "ProtocolError";
  }
}

export class TimeoutError extends MCPError {
  constructor(requestId: string) {
    super(`Request timed out: ${requestId}`);
    this.name = "TimeoutError";
  }
}

export function isMCPError(error: unknown): error is MCPError {
  return error instanceof MCPError;
}