/**
 * Error classes for MCP Server Bridge
 */

/**
 * Base error class for bridge-related errors
 */
export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeError";
  }
}

/**
 * Error related to connection issues
 */
export class ConnectionError extends BridgeError {
  constructor(message: string) {
    super(`Connection error: ${message}`);
    this.name = "ConnectionError";
  }
}

/**
 * Error related to child process
 */
export class ProcessError extends BridgeError {
  constructor(message: string) {
    super(`Process error: ${message}`);
    this.name = "ProcessError";
  }
}

/**
 * Error related to protocol handling
 */
export class ProtocolError extends BridgeError {
  constructor(message: string) {
    super(`Protocol error: ${message}`);
    this.name = "ProtocolError";
  }
}

/**
 * Check if an error is a BridgeError
 */
export function isBridgeError(error: unknown): error is BridgeError {
  return error instanceof BridgeError;
}