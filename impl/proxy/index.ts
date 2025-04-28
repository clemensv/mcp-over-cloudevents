#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
  RequestSchema 
} from "@modelcontextprotocol/sdk/types.js";
import { CloudEvent } from "cloudevents";
import { WebSocket } from "ws";
import { connect as mqttConnect, MqttClient } from "mqtt";
import * as zod from 'zod';

import { MCPError, ConnectionError } from './common/errors.js';
import { VERSION } from "./common/version.js";
import { parseCorrelationId } from "./common/utils.js";

// Configuration options for the proxy
interface ProxyOptions {
  transport: "websocket" | "mqtt";
  endpoint: string;
  topic?: string; // For MQTT
}

// Common request base type to replace missing RequestBase
interface RequestBase {
  type: string;
  params: any;
}

// Main proxy class
class MCPProxy {
  private server: Server;
  private wsClient?: WebSocket;
  private mqttClient?: MqttClient;
  private pendingRequests: Map<string, (response: any) => void>;
  private mqttTopic: string;

  constructor(private options: ProxyOptions) {
    this.server = new Server(
      {
        name: "mcp-cloudevents-proxy",
        version: VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
    this.pendingRequests = new Map();
    this.mqttTopic = options.topic || "mcp";
  }

  // Setup the proxy server
  async start() {
    // Connect to the backend based on transport type
    if (this.options.transport === "websocket") {
      this.connectWebSocket();
    } else if (this.options.transport === "mqtt") {
      this.connectMQTT();
    } else {
      throw new Error(`Unsupported transport: ${this.options.transport}`);
    }

    // Set up handlers for MCP requests
    const transport = new StdioServerTransport();
    
    // Set up message handling using the correct API
    transport.onmessage = async (message: any) => {
      try {
        // Parse the request if it's a string
        const request = typeof message === 'string' ? JSON.parse(message) : message;
        let result: any = null;
        
        // Handle different request types
        if (request.type === ListToolsRequestSchema.shape.type.value) {
          result = await this.handleMCPRequest(request, ListToolsRequestSchema.shape.type.value);
        } else if (request.type === CallToolRequestSchema.shape.type.value) {
          result = await this.handleMCPRequest(request, CallToolRequestSchema.shape.type.value);
        } else {
          result = { error: `Unsupported request type: ${request.type}` };
        }
        
        // Send response
        if (transport.send) {
          transport.send(JSON.stringify(result) + '\n');
        }
      } catch (error) {
        console.error('Error handling request:', error);
        if (transport.send) {
          transport.send(JSON.stringify({ error: String(error) }) + '\n');
        }
      }
    };
    
    // Start the transport
    if (typeof transport.start === 'function') {
      transport.start();
    }
    
    console.error(`MCP CloudEvents Proxy running on stdio, connected to ${this.options.endpoint} via ${this.options.transport}`);
  }

  // Generic handler for MCP requests that forwards them as CloudEvents
  private async handleMCPRequest(
    request: any,
    requestType: string
  ): Promise<any> {
    console.error(`[DEBUG] Handling MCP request of type: ${requestType}`);
    
    return new Promise((resolve, reject) => {
      // Create a Cloud Event from the MCP request
      const requestId = crypto.randomUUID();
      const cloudEvent = new CloudEvent({
        type: `mcp.${requestType}.request`,
        source: "mcp-proxy",
        id: requestId,
        data: request.params
      });

      // Store the resolver for when we get a response
      this.pendingRequests.set(requestId, (response) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });

      // Send the request via the appropriate transport
      this.sendRequest(cloudEvent);
    });
  }

  // Send a request via the chosen transport
  private sendRequest(cloudEvent: CloudEvent) {
    const serialized = JSON.stringify(cloudEvent);
    
    if (this.wsClient?.readyState === WebSocket.OPEN) {
      this.wsClient.send(serialized);
    } else if (this.mqttClient?.connected) {
      const topic = `${this.mqttTopic}/${cloudEvent.type}`;
      this.mqttClient.publish(topic, serialized);
    } else {
      console.error("Cannot send request: Transport not connected");
      // Remove the pending request to avoid memory leaks
      if (cloudEvent.id) {
        this.pendingRequests.delete(cloudEvent.id);
      }
    }
  }

  // Handle a response from the backend
  private handleResponse(event: CloudEvent) {
    const correlationId = parseCorrelationId(event);
    
    if (!correlationId) {
      // This is a notification, not a response to a request
      this.handleNotification(event);
      return;
    }
    
    const resolver = this.pendingRequests.get(correlationId);
    if (resolver) {
      const response = event.data;
      resolver(response);
      this.pendingRequests.delete(correlationId);
    } else {
      console.error(`Received response for unknown request ID: ${correlationId}`);
    }
  }

  // Handle a notification from the backend
  private handleNotification(event: CloudEvent) {
    console.error(`[DEBUG] Received notification: ${event.type}`);
    
    // Process different notification types
    switch(event.type) {
      case "mcp.tools.update.notification":
      case "mcp.resources.update.notification":
      case "mcp.prompts.update.notification":
        // Handle catalog updates - could update internal state or forward to client
        break;
      case "mcp.server.shutdown.notification":
        console.error("Backend error:", event.data);
        break;
      default:
        console.error(`Unknown notification type: ${event.type}`);
    }
  }

  // Connect to a WebSocket server
  private connectWebSocket() {
    console.error(`Connecting to WebSocket endpoint: ${this.options.endpoint}`);
    
    this.wsClient = new WebSocket(this.options.endpoint, {
      // Using cloudevents.json subprotocol as per spec
      protocol: "cloudevents.json"
    });

    this.wsClient.on("open", () => {
      console.error("WebSocket connection established");
      // Request the meta manifest
      this.fetchMetaManifest();
    });

    this.wsClient.on("message", (data) => {
      try {
        const eventData = JSON.parse(data.toString());
        const event = new CloudEvent(eventData);
        console.error(`[DEBUG] Received message of type: ${event.type}`);
        this.handleResponse(event);
      } catch (error) {
        console.error("Error parsing CloudEvent:", error);
      }
    });

    this.wsClient.on("error", (error) => {
      console.error("WebSocket error:", error);
    });

    this.wsClient.on("close", (code, reason) => {
      console.error(`WebSocket connection closed: ${code} - ${reason}`);
      // Could implement reconnection logic here
    });
  }

  // Connect to an MQTT broker
  private connectMQTT() {
    console.error(`Connecting to MQTT broker: ${this.options.endpoint}`);
    
    // Create a unique client ID
    const clientId = `mcp-proxy-${crypto.randomUUID()}`;
    
    this.mqttClient = mqttConnect(this.options.endpoint, {
      clientId,
      clean: true
    });

    this.mqttClient.on("connect", () => {
      console.error("MQTT connection established");
      
      // Subscribe to response topics
      this.mqttClient?.subscribe(`${this.mqttTopic}/+/+/response`);
      
      // Subscribe to notification topics
      this.mqttClient?.subscribe(`${this.mqttTopic}/+/+/notification`);
      
      // Subscribe to meta topic for manifest updates
      this.mqttClient?.subscribe(`${this.mqttTopic}/meta`);
      
      // Request the meta manifest
      this.fetchMetaManifest();
    });

    this.mqttClient.on("message", (topic, message) => {
      try {
        const eventData = JSON.parse(message.toString());
        const event = new CloudEvent(eventData);
        console.error(`[DEBUG] Received message from topic ${topic} of type: ${event.type}`);
        this.handleResponse(event);
      } catch (error) {
        console.error(`Error parsing CloudEvent from topic ${topic}:`, error);
      }
    });

    this.mqttClient.on("error", (error) => {
      console.error("MQTT error:", error);
    });

    this.mqttClient.on("close", () => {
      console.error("MQTT connection closed");
      // Could implement reconnection logic here
    });
  }

  // Fetch the meta manifest from the server
  private fetchMetaManifest() {
    const requestId = crypto.randomUUID();
    const metaRequest = new CloudEvent({
      type: "mcp.meta.request",
      source: "mcp-proxy",
      id: requestId,
      data: {} as any // Type cast to fix CloudEvent type issue
    });

    this.pendingRequests.set(requestId, (response) => {
      console.error("Received meta manifest:", JSON.stringify(response, null, 2));
      // Could initialize the proxy's capabilities based on the manifest
    });

    this.sendRequest(metaRequest);
  }
}

// Parse command line arguments
function parseArgs(): ProxyOptions {
  const args = process.argv.slice(2);
  const options: ProxyOptions = {
    transport: "websocket",
    endpoint: "ws://localhost:8080"
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--transport":
      case "-t":
        const transport = args[++i];
        if (transport !== "websocket" && transport !== "mqtt") {
          throw new Error(`Invalid transport: ${transport}. Must be 'websocket' or 'mqtt'`);
        }
        options.transport = transport as "websocket" | "mqtt";
        break;
      case "--endpoint":
      case "-e":
        options.endpoint = args[++i];
        break;
      case "--topic":
        options.topic = args[++i];
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
    }
  }

  return options;
}

function printUsage() {
  console.error(`
MCP CloudEvents Proxy

Usage:
  mcp-proxy [options]

Options:
  -t, --transport <type>   Transport type: 'websocket' or 'mqtt' (default: websocket)
  -e, --endpoint <url>     Backend endpoint URL (default: ws://localhost:8080)
  --topic <topic>          MQTT topic prefix (default: mcp)
  -h, --help               Show this help message
`);
}

// Main entry point
async function main() {
  try {
    const options = parseArgs();
    const proxy = new MCPProxy(options);
    await proxy.start();
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

main();