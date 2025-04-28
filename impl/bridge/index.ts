#!/usr/bin/env node
/**
 * MCP Server Bridge
 * 
 * This bridge wraps an existing MCP server executable and exposes it via WebSocket or MQTT,
 * enabling remote clients to access MCP servers over the network.
 */
import { spawn, ChildProcess } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { connect as mqttConnect, MqttClient } from 'mqtt';
import { CloudEvent } from 'cloudevents';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';

import { VERSION } from './common/version.js';
import { parseCorrelationId, safeParseJson } from './common/utils.js';
import { BridgeError, ConnectionError } from './common/errors.js';

/**
 * Configuration options for the MCP Server Bridge
 */
interface BridgeOptions {
  // Target executable to wrap (the MCP server)
  command: string;
  // Arguments to the MCP server
  args?: string[];
  // Protocol to expose the server on (WebSocket or MQTT)
  protocol: 'websocket' | 'mqtt';
  // Host to bind to (for WebSocket server)
  host?: string;
  // Port to bind to (for WebSocket server) or connect to (for MQTT broker)
  port: number;
  // MQTT broker URL (only used for MQTT protocol)
  brokerUrl?: string;
  // MQTT topic prefix (only used for MQTT protocol)
  topic?: string;
  // Whether to provide debug output
  debug?: boolean;
}

/**
 * MCP Server Bridge class
 * 
 * Wraps an MCP server and exposes it via WebSocket or MQTT
 */
class MCPServerBridge {
  private childProcess: ChildProcess | null = null;
  private wsServer: WebSocketServer | null = null;
  private mqttClient: MqttClient | null = null;
  private connectedClients: Set<WebSocket> = new Set();
  private mqttTopic: string;
  private pendingResponses: Map<string, string> = new Map();
  private isServerRunning = false;
  private shouldShutdown = false;

  constructor(private options: BridgeOptions) {
    this.mqttTopic = options.topic || 'mcp';
    
    // Add default host if not specified
    if (!options.host) {
      this.options.host = '127.0.0.1';
    }

    // Debug log helper
    this.log = this.options.debug 
      ? (message: string, ...args: any[]) => console.error(`[DEBUG] ${message}`, ...args)
      : () => {};
  }

  /**
   * Start the bridge
   */
  async start(): Promise<void> {
    this.log(`Starting MCP Server Bridge v${VERSION}`);
    
    if (!existsSync(this.options.command)) {
      throw new BridgeError(`Command not found: ${this.options.command}`);
    }

    try {
      // Start the child process (MCP server)
      await this.startChildProcess();
      
      // Start the appropriate server based on protocol
      if (this.options.protocol === 'websocket') {
        await this.startWebSocketServer();
      } else if (this.options.protocol === 'mqtt') {
        await this.connectToMQTTBroker();
      } else {
        throw new BridgeError(`Unsupported protocol: ${this.options.protocol}`);
      }

      // Handle process termination
      process.on('SIGINT', this.shutdownGracefully.bind(this));
      process.on('SIGTERM', this.shutdownGracefully.bind(this));
      
      this.log('Bridge is ready and running');
    } catch (error) {
      console.error('Failed to start bridge:', error);
      this.shutdownGracefully();
      throw error;
    }
  }

  /**
   * Shut down the bridge gracefully
   */
  private async shutdownGracefully(): Promise<void> {
    if (this.shouldShutdown) return;
    this.shouldShutdown = true;
    
    console.error('Shutting down...');
    
    // Close connections to clients
    if (this.wsServer) {
      for (const client of this.connectedClients) {
        client.close();
      }
      this.wsServer.close();
    }
    
    if (this.mqttClient) {
      await new Promise<void>((resolve) => {
        this.mqttClient!.end(false, {}, () => resolve());
      });
    }
    
    // Kill child process
    if (this.childProcess) {
      this.childProcess.kill();
    }
    
    process.exit(0);
  }

  /**
   * Start the child process (MCP server)
   */
  private async startChildProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.log(`Starting child process: ${this.options.command} ${this.options.args?.join(' ') || ''}`);
      
      this.childProcess = spawn(this.options.command, this.options.args || [], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Handle process events
      this.childProcess.on('error', (error) => {
        console.error('Child process error:', error);
        reject(new BridgeError(`Failed to start child process: ${error.message}`));
      });

      this.childProcess.on('exit', (code, signal) => {
        if (!this.shouldShutdown) {
          console.error(`Child process exited unexpectedly with code ${code} (signal: ${signal})`);
          this.shutdownGracefully();
        }
      });

      // Set up communication with child process
      if (this.childProcess.stdin && this.childProcess.stdout) {
        // Handle responses from child process
        this.childProcess.stdout.on('data', (data) => {
          const message = data.toString();
          this.handleMCPResponse(message);
        });

        // Handle errors from child process
        this.childProcess.stderr?.on('data', (data) => {
          console.error(`[Child stderr] ${data.toString()}`);
        });
        
        // Child process is running
        this.isServerRunning = true;
        resolve();
      } else {
        reject(new BridgeError('Failed to establish communication with child process'));
      }
    });
  }

  /**
   * Start the WebSocket server
   */
  private async startWebSocketServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const httpServer = createServer();
        
        this.wsServer = new WebSocketServer({
          server: httpServer,
          path: '/mcp'
        });

        httpServer.listen(this.options.port, this.options.host, () => {
          this.log(`WebSocket server listening on ${this.options.host}:${this.options.port}/mcp`);
          resolve();
        });

        this.wsServer.on('connection', (socket) => {
          this.log('New WebSocket client connected');
          
          this.connectedClients.add(socket);
          
          socket.on('message', (data) => {
            try {
              const message = data.toString();
              // Fix: CloudEvent doesn't have a deserialize method, parse it manually
              const eventData = JSON.parse(message);
              const event = new CloudEvent(eventData);
              this.handleClientRequest(event, socket);
            } catch (error) {
              console.error('Error processing client message:', error);
              // Send error response
              const errorEvent = new CloudEvent({
                type: 'mcp.error',
                source: 'mcp-bridge',
                data: { error: 'Invalid CloudEvent format' } as any
              });
              socket.send(JSON.stringify(errorEvent));
            }
          });

          socket.on('close', () => {
            this.log('WebSocket client disconnected');
            this.connectedClients.delete(socket);
          });

          socket.on('error', (error) => {
            console.error('WebSocket client error:', error);
            this.connectedClients.delete(socket);
          });
        });

        this.wsServer.on('error', (error) => {
          console.error('WebSocket server error:', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Connect to MQTT broker
   */
  private async connectToMQTTBroker(): Promise<void> {
    return new Promise((resolve, reject) => {
      const brokerUrl = this.options.brokerUrl || `mqtt://${this.options.host}:${this.options.port}`;
      
      this.log(`Connecting to MQTT broker: ${brokerUrl}`);

      const clientId = `mcp-bridge-${randomUUID()}`;

      this.mqttClient = mqttConnect(brokerUrl, {
        clientId,
        clean: true
      });

      this.mqttClient.on('connect', () => {
        this.log('Connected to MQTT broker');

        // Subscribe to request topics
        this.mqttClient!.subscribe(`${this.mqttTopic}/+/request`);
        
        resolve();
      });

      this.mqttClient.on('message', (topic, message) => {
        try {
          const messageStr = message.toString();
          // Fix: CloudEvent doesn't have a deserialize method, parse it manually
          const eventData = JSON.parse(messageStr);
          const event = new CloudEvent(eventData);
          this.handleClientRequest(event);
        } catch (error) {
          console.error(`Error processing MQTT message on topic ${topic}:`, error);
          // Publish error notification
          const errorEvent = new CloudEvent({
            type: 'mcp.error',
            source: 'mcp-bridge',
            data: { error: 'Invalid CloudEvent format' } as any
          });
          this.mqttClient!.publish(`${this.mqttTopic}/error`, JSON.stringify(errorEvent));
        }
      });

      this.mqttClient.on('error', (error) => {
        console.error('MQTT client error:', error);
        reject(error);
      });
    });
  }

  /**
   * Process a client request
   */
  private handleClientRequest(event: CloudEvent, socket?: WebSocket): void {
    if (!this.childProcess?.stdin || !this.isServerRunning) {
      const errorEvent = new CloudEvent({
        type: 'mcp.error',
        source: 'mcp-bridge',
        data: { error: 'MCP server not running' } as any
      });
      this.sendResponse(errorEvent, socket);
      return;
    }
    
    const requestId = event.id || randomUUID();
    const data = event.data;

    if (!data) {
      const errorEvent = new CloudEvent({
        type: 'mcp.error',
        source: 'mcp-bridge',
        data: { error: 'Missing CloudEvent data' } as any,
        correlationid: requestId
      });
      this.sendResponse(errorEvent, socket);
      return;
    }

    this.log(`Received client request: ${event.type}, id: ${requestId}`);
    
    // Store the response target (WebSocket client or null for MQTT)
    this.pendingResponses.set(requestId, socket ? 'ws' : 'mqtt');
    
    // Forward request to child process
    const mcpRequest = JSON.stringify(data) + '\n';
    this.childProcess.stdin!.write(mcpRequest);
  }

  /**
   * Handle a response from the MCP server
   */
  private handleMCPResponse(message: string): void {
    // MCP servers communicate over newline-delimited JSON
    const lines = message.trim().split('\n');
    
    for (const line of lines) {
      try {
        if (!line.trim()) continue;
        
        const response = safeParseJson(line);
        if (!response) continue;

        // Find the request ID if possible
        // This is tricky since MCP doesn't provide correlation IDs by default
        // We'll use the first pending request as a fallback
        let requestId: string = '';
        
        if (this.pendingResponses.size > 0) {
          const firstKey = this.pendingResponses.keys().next().value;
          if (firstKey) {
            requestId = firstKey;
          }
        }

        // Get response target type (WebSocket or MQTT)
        const responseTarget = this.pendingResponses.get(requestId);
        if (!responseTarget) {
          this.log('Response received but no pending request found');
          return;
        }
        
        // Create CloudEvent from MCP response
        const cloudEvent = new CloudEvent({
          type: 'mcp.response',
          source: 'mcp-bridge',
          id: randomUUID(),
          correlationid: requestId,
          data: response as any
        });
        
        // Send to appropriate target based on stored type
        if (responseTarget === 'ws') {
          // Find and respond to the WebSocket client
          for (const client of this.connectedClients) {
            // In a real implementation, you'd track which client sent which request
            // For this example, we broadcast to all connected clients
            client.send(JSON.stringify(cloudEvent));
          }
        } else if (responseTarget === 'mqtt') {
          // Publish to MQTT response topic
          this.mqttClient?.publish(
            `${this.mqttTopic}/response`,
            JSON.stringify(cloudEvent)
          );
        }
        
        // Clean up
        this.pendingResponses.delete(requestId);
      } catch (error) {
        console.error('Error processing MCP server response:', error);
      }
    }
  }

  /**
   * Send a response to the client
   */
  private sendResponse(event: CloudEvent, socket?: WebSocket): void {
    const serialized = JSON.stringify(event);
    
    if (socket) {
      // WebSocket response
      socket.send(serialized);
    } else if (this.mqttClient) {
      // MQTT response
      this.mqttClient.publish(`${this.mqttTopic}/response`, serialized);
    }
  }

  /**
   * Debug log function
   */
  private log(message: string, ...args: any[]): void {
    // Implemented in constructor
  }
}

/**
 * Parse command line arguments
 */
function parseArguments(): BridgeOptions {
  const args = process.argv.slice(2);
  
  if (args.length < 1 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const options: BridgeOptions = {
    command: '',
    protocol: 'websocket',
    port: 8080,
    debug: false
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i++];
    
    switch (arg) {
      case '--command':
      case '-c':
        options.command = args[i++];
        break;
        
      case '--args':
      case '-a':
        options.args = args[i++].split(' ');
        break;
        
      case '--protocol':
      case '-p':
        const protocol = args[i++];
        if (protocol !== 'websocket' && protocol !== 'mqtt') {
          console.error(`Invalid protocol: ${protocol}. Must be 'websocket' or 'mqtt'`);
          process.exit(1);
        }
        options.protocol = protocol as 'websocket' | 'mqtt';
        break;
        
      case '--host':
        options.host = args[i++];
        break;
        
      case '--port':
        options.port = parseInt(args[i++], 10);
        break;
        
      case '--broker':
      case '-b':
        options.brokerUrl = args[i++];
        break;
        
      case '--topic':
      case '-t':
        options.topic = args[i++];
        break;
        
      case '--debug':
      case '-d':
        options.debug = true;
        break;
        
      default:
        // If no --command specified, assume first positional arg is the command
        if (!options.command) {
          options.command = arg;
        } else {
          console.error(`Unknown argument: ${arg}`);
          printUsage();
          process.exit(1);
        }
    }
  }

  if (!options.command) {
    console.error('No command specified. Use --command or positional argument.');
    printUsage();
    process.exit(1);
  }

  return options;
}

/**
 * Print usage information
 */
function printUsage(): void {
  console.error(`
MCP Server Bridge v${VERSION}

Usage:
  mcp-bridge [options] <command>
  mcp-bridge --command <command> [options]

Description:
  Wraps an MCP server executable and exposes it via WebSocket or MQTT.

Options:
  --command, -c <path>     Path to MCP server executable
  --args, -a <args>        Arguments to pass to the MCP server (space-separated string)
  --protocol, -p <proto>   Protocol to use: 'websocket' or 'mqtt' (default: websocket)
  --host <host>            Host to bind to for WebSocket server (default: 127.0.0.1)
  --port <port>            Port to bind to or connect on (default: 8080)
  --broker, -b <url>       MQTT broker URL (for MQTT protocol, default: mqtt://host:port)
  --topic, -t <topic>      MQTT topic prefix (default: mcp)
  --debug, -d              Enable debug logging
  --help, -h               Show this help message

Examples:
  # Expose a GitHub MCP server via WebSocket
  mcp-bridge --command ./github/dist/index.js --port 9000

  # Expose a GitHub MCP server via MQTT
  mcp-bridge -c ./github/dist/index.js -p mqtt -b mqtt://broker.example.com -t my/mcp
`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const options = parseArguments();
    const bridge = new MCPServerBridge(options);
    await bridge.start();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();