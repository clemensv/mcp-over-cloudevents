/**
 * Utility functions for MCP Server Bridge
 */
import { VERSION } from './version.js';

/**
 * User agent string for the bridge
 */
export const USER_AGENT = `mcp-server-bridge/v${VERSION} (node)`;

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

/**
 * Format a command and arguments for display
 */
export function formatCommand(command: string, args?: string[]): string {
  if (!args || args.length === 0) {
    return command;
  }
  
  // Quote arguments with spaces
  const formattedArgs = args.map(arg => {
    return arg.includes(' ') ? `"${arg}"` : arg;
  });
  
  return `${command} ${formattedArgs.join(' ')}`;
}

/**
 * Create a map of client connections
 * Each client has a unique ID and associated connection information
 */
export class ClientManager<T> {
  private clients = new Map<string, T>();
  
  add(id: string, client: T): void {
    this.clients.set(id, client);
  }
  
  get(id: string): T | undefined {
    return this.clients.get(id);
  }
  
  remove(id: string): boolean {
    return this.clients.delete(id);
  }
  
  getAll(): T[] {
    return Array.from(this.clients.values());
  }
  
  getIds(): string[] {
    return Array.from(this.clients.keys());
  }
  
  size(): number {
    return this.clients.size;
  }
  
  clear(): void {
    this.clients.clear();
  }
}