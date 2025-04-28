# MCP CloudEvents Bridge

A bridge that wraps existing MCP server executables and exposes them via WebSocket or MQTT, enabling remote clients to access MCP servers over a network connection.

## Description

MCP CloudEvents Bridge is a utility that allows you to wrap any Model Context Protocol (MCP) server executable and expose it via WebSocket or MQTT protocol. This enables client applications to access MCP servers remotely across the network, extending the reach of MCP servers beyond local processes.

The bridge acts as a mediator between:
- An MCP server executable (that normally only communicates via stdin/stdout)
- Network clients that connect via WebSocket or MQTT

## Installation

You can install the MCP CloudEvents Bridge using npm:

```bash
npm install -g @modelcontextprotocol/server-bridge
```

## Usage

The bridge can be used as a command-line tool:

```bash
mcp-bridge [options] <command>
```

or:

```bash
mcp-bridge --command <command> [options]
```

### Examples

#### Expose a GitHub MCP Server via WebSocket

```bash
mcp-bridge --command ./github/dist/index.js --port 9000
```

#### Expose a GitHub MCP Server via MQTT

```bash
mcp-bridge -c ./github/dist/index.js -p mqtt -b mqtt://broker.example.com -t my/mcp
```

## Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--command` | `-c` | Path to MCP server executable | (required) |
| `--args` | `-a` | Arguments to pass to the MCP server (space-separated string) | none |
| `--protocol` | `-p` | Protocol to use: 'websocket' or 'mqtt' | 'websocket' |
| `--host` | | Host to bind to for WebSocket server | '127.0.0.1' |
| `--port` | | Port to bind to or connect on | 8080 |
| `--broker` | `-b` | MQTT broker URL (for MQTT protocol) | mqtt://host:port |
| `--topic` | `-t` | MQTT topic prefix | 'mcp' |
| `--debug` | `-d` | Enable debug logging | false |
| `--help` | `-h` | Show help message | |

## How It Works

The bridge:

1. Starts the specified MCP server executable as a child process
2. Creates a WebSocket server or connects to an MQTT broker
3. Forwards requests from clients to the MCP server
4. Returns responses from the MCP server to clients as CloudEvents

## WebSocket Protocol

When using the WebSocket protocol:

- The bridge starts a WebSocket server on the specified host and port
- Clients connect to `ws://<host>:<port>/mcp`
- Messages are exchanged as CloudEvents in JSON format
- Supports the 'cloudevents.json' subprotocol

## MQTT Protocol

When using the MQTT protocol:

- The bridge connects to the specified MQTT broker
- Messages are exchanged using the topic pattern `<topic>/<event-type>`
- Requests: `<topic>/+/request`
- Responses: `<topic>/response`
- Messages are formatted as CloudEvents in JSON

## CloudEvents Format

All messages are formatted as CloudEvents with the following properties:

- `type`: The type of the event (e.g., 'mcp.list_tools.request')
- `source`: The source of the event (either 'mcp-bridge' or 'mcp-proxy')
- `id`: A unique ID for the event
- `correlationid`: (for responses) The ID of the original request
- `data`: The payload of the event

## Troubleshooting

### Common Issues

- **"Command not found"**: Ensure the path to the MCP server executable is correct
- **"Failed to start child process"**: Check if the executable has the right permissions
- **"WebSocket server error"**: Port might be in use or you don't have permissions
- **"MQTT client error"**: Check broker URL and credentials if applicable

### Debug Mode

Use the `--debug` or `-d` flag to enable debug logging, which provides more detailed information about the bridge's operation.

## License

MIT

## See Also

- [MCP CloudEvents Proxy](../proxy/README.md) - A compatible client for connecting to this bridge
- [Model Context Protocol](https://modelcontextprotocol.io) - Learn more about the MCP specification