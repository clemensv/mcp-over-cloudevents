# MCP CloudEvents Proxy

A Model Context Protocol (MCP) proxy that acts as an MCP server towards the caller and connects to a WebSocket or MQTT server using CloudEvents binding.

## Overview

This proxy implements the MCP-over-CloudEvents specification, enabling communication with remote MCP servers via WebSocket or MQTT transports with CloudEvents structured framing.

Key features:

- Acts as a normal MCP server locally while forwarding operations to remote endpoints
- Supports both WebSocket and MQTT transports
- Implements CloudEvents binding for all MCP interactions
- Provides asynchronous communication patterns

## Installation

```bash
npm install
npm run build
```

## Usage

```bash
# Using WebSocket transport (default)
node dist/index.js --endpoint wss://my-mcp-server.example.com/ws

# Using MQTT transport
node dist/index.js --transport mqtt --endpoint mqtt://broker.example.com --topic my-mcp-topic
```

## Command-line Options

- `-t, --transport <type>`: Transport type (`websocket` or `mqtt`). Default: `websocket`
- `-e, --endpoint <url>`: Backend endpoint URL. Default: `ws://localhost:8080`
- `--topic <topic>`: MQTT topic prefix (only used with MQTT transport). Default: `mcp`
- `-h, --help`: Show help message

## Architecture

The proxy works by:

1. Acting as an MCP server toward client applications
2. Converting MCP requests to CloudEvents
3. Transmitting CloudEvents to a remote server using WebSocket or MQTT
4. Receiving responses as CloudEvents and forwarding them back to clients

```
+------------------------+
|      MCP Client        |
|                        |
|  +------------------+  |
|  | MCP Proxy        |  |-------------------------+   WebSocket/MQTT  +------------------+
|  +------------------+  |                         | <--------------> | Remote Server     |
|                        |                         |                   +------------------+
+------------------------+
```

## CloudEvents Message Patterns

- Request: `mcp.<method>.request` (e.g., `mcp.tools.call.request`)
- Response: `mcp.<method>.response` (e.g., `mcp.tools.call.response`)
- Notifications: `mcp.<category>.<action>.notification` (e.g., `mcp.tools.update.notification`)

## Development

```bash
npm run watch
```

## License

MIT
