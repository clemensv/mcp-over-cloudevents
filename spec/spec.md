Model Context Protocol (MCP) over WebSocket with CloudEvents Binding

Author: Clemens Vasters
Date: 2023-10-03

## 1. Overview

The Model Context Protocol (MCP) is a lightweight, extensible protocol designed
to enhance AI applications by providing standardized ways to interact with
tools, resources, and prompts. At its core, MCP enables AI models to access
external capabilities and information in a structured, secure manner.

This specification introduces a networked model for MCP by binding it to
WebSocket or MQTT transports and framing all communication in CloudEvents
structured JSON. This preserves all basic MCP exchange patterns
(request-response and notifications) while enabling asynchronous, scalable, and
resilient backends.

The MCP Client remains unchanged from the application's point of view. It loads
local MCP servers directly as always. For remote servers, the client loads an
embedded MCP proxy instance per remote endpoint. Each MCP proxy behaves like a
normal server locally but forwards all operations to the respective remote
endpoint using WebSocket or MQTT.

CloudEvents enables asynchronous communication patterns, where requests and
responses are loosely coupled and highly scalable. Instead of assuming instant
replies as in traditional RPC, the client can issue work requests that are
queued, distributed, and executed when backend resources allow.

For developers already familiar with MCP:

- You still interact with servers using the same familiar tool/resource/prompt
  abstractions.
- Remote servers feel exactly like local ones.
- No additional complexity is introduced on the client side.

The integration of CloudEvents and asynchronous transport dramatically extends
MCP's operational range without altering the simplicity of its local programming
model.

## 2. Introduction to CloudEvents

CloudEvents is a mature, widely-adopted CNCF standard for describing event data
in a common way. It enables interoperability between systems by abstracting
event metadata independently of transport or serialization details.

CloudEvents supports multiple transport bindings including HTTP, WebSocket,
MQTT, and NATS, and multiple format encodings such as JSON, Avro, and Protobuf.
By adopting CloudEvents, MCP benefits from an open standard that integrates
cleanly with modern event-driven architectures.

Using CloudEvents also enables advanced interaction patterns that are difficult
or impossible with classic RPC models:

- **Multi-response replies**: A single request can result in multiple responses
  over time, enabling server push without coupling to request lifecycles.
- **Scatter-gather patterns**: A client may send a request to multiple
  endpoints, gather multiple asynchronous responses, and correlate them based on
  metadata like `correlationid`.

These capabilities significantly increase flexibility and resilience in
distributed systems.

Remotely callable MCP implementations will require significant scale, while the
operations they perform may be computationally expensive. Therefore, requests
are best queued and distributed across processing backends. CloudEvents'
asynchronous flow model naturally enables MCP backends to be implemented atop
robust message brokers, supporting decoupled, scalable, and highly available
execution architectures.

## 3. Architecture

MCP architecture separates host-facing communication from backend execution,
while maintaining the familiar programming model where MCP servers are loaded
into the client. The MCP proxy behaves exactly like a local MCP server but
forwards operations to remote servers using WebSocket or MQTT transports with
CloudEvents structured framing.

Each remote MCP server connection results in a dedicated MCP proxy instance
inside the client. The proxy retrieves the remote server's meta manifest and
internally synthesizes virtual `list` calls for tools, resources, prompts, and
roots. Notifications from the backend dynamically update the proxy's internal
cache, and any changes are propagated transparently to the client to keep the
resource and capability view consistent.

The MCP WebSocket endpoint is also an HTTP endpoint. When accessed via an HTTP
GET request without WebSocket upgrade headers, it responds with the "meta"
manifest, enabling clients to perform capability discovery without establishing
a WebSocket connection.

The "vault" is a secure storage for user-scoped credentials and access tokens
that is managed on behalf of trusted MCP servers. The vault prevents secrets
to be exposed into the client context, while allowing the server to access them
when needed.

Details about host communication, backend interaction, proxy behavior, and
transport bindings are described in the following sections.

```ascii
 +------------------------+                       +------------------+
 |      MCP Client        |                       |       Vault      |
 |  +------------------+  |                       +------------------+
 |  | Local MCP Server |  |                                 ^
 |  +------------------+  |                                 |
 |                        |                                 |
 |  +------------------+  |       WebSocket       +------------------+
 |  | MCP Proxy #1     |  |---------------------> | Remote Server #1 |
 |  +------------------+  |                       +------------------+
 |                        |
 |  +------------------+  |       MQTT            +------------------+
 |  | MCP Proxy #2     |  |---------------------> | Remote Server #2 |
 |  +------------------+  |                       +------------------+
 +------------------------+
```

- Each MCP Proxy instance connects to a distinct remote MCP server.
- All proxies coexist alongside locally loaded MCP servers within the client.
- The MCP Client presents a unified local server abstraction to the host
  application.

## 4. Security Model

Many MCP servers require authentication credentials and/or access tokens to
access resources. Making all these credentials available in a client context is
a significant security risk from many perspectives. For example, if a client is
compromised, the attacker could access all credentials and tokens, potentially
leading to exfiltration of sensitive data or unauthorized access to resources.

In this specification, we define the concept of a "vault" as a secure storage
for such credentials and for access tokens. The "vault" contains user-scoped
environment variables that can be requested by the remote server on behalf of
the requesting client. The environment variables are not available to the client
directly, but only to parties that the vault trusts. The vault is responsible
for evaluating the token that the client provides and for deciding whether to
grant access to the requested environment variables.

The specific token format and the vault implementation are outside the scope of
this specification. This specification only defined the `accesstoken` attribute
extension for CloudEvents, which is used to pass the token from the client to
the server.

The server MUST NOT retain either the `accesstoken` or the environment variables
after the request is completed. The server MUST NOT log the `accesstoken` or
the environment variables. The server MUST NOT share the `accesstoken` or the
environment variables with any third party.

All communication between the client and the server MUST be secured using TLS
(HTTPS or WSS). The client MUST verify the server's certificate and hostname.
An application-level authentication mechanism (e.g., OAuth2) MAY be used to
authenticate the client to the server.

## 5. CloudEvents attributes

The following attributes have special meaning in the context of MCP-over-CloudEvents:

- `specversion`: MUST be set to `1.0` (CloudEvents version).
- `id`: MUST be a unique identifier for the event. It is used to correlate
  requests and responses.
- `source`: MUST be set to `urn:client` for requests and `urn:server` for responses.
- `type`: MUST be set to the event type as defined in the following sections.
- `correlationid`: MUST be set to the `id` of the request that this response is
  related to. It is only present in responses and notifications.
- `accesstoken`: MAY be set to a token that the client provides to the server to
  access the vault. The server MUST verify the token before accessing the vault.
- `time`: MAY be set to the time when the event was created. It is not required but
  recommended for traceability.

The `correlationid` and `accesstoken` attributes are extensions.

## 6. Event Types and Schemas

In MCP-over-CloudEvents, the `data` object of each CloudEvent is byte-for-byte
equal to the `params` object of the underlying JSON-RPC 2.0 message defined by
the MCP core specification. The JSON-RPC `id` is carried in the CloudEvent `id`,
and the JSON-RPC result or error wrapper is implied by the specific event type
(request, response, or notification). This mapping eliminates one wrapper layer
while preserving all semantics.

This section defines the supported MCP CloudEvent types and provides complete
CloudEvent envelopes.  `data` payloads use the **native MCP parameters** for
each method (not wrapped in JSON‑RPC), restoring the concise format used earlier
in this document.

### 6.1. Tool Invocation (`tools/call`)

Tool invocation allows clients to execute tools provided by MCP servers. This
event pattern enables AI models to take actions in the world through
well-defined tool interfaces. The server handles execution and returns results
asynchronously, allowing for long-running operations.

#### 6.1.1. Request `mcp.tools.call.request`

```json
{
  "specversion": "1.0",
  "id": "ce-req-001",
  "source": "urn:client",
  "type": "mcp.tools.call.request",
  "data": {
    "tool": "sendEmail",
    "parameters": {
      "recipient": "user@example.com",
      "subject": "Test",
      "body": "This is a test email."
    }
  }
}
```

#### 6.1.2. Response `mcp.tools.call.response`

```json
{
  "specversion": "1.0",
  "id": "ce-res-001",
  "source": "urn:server",
  "type": "mcp.tools.call.response",
  "correlationid": "ce-req-001",
  "data": {
    "status": "success",
    "result": {"messageId": "abc123"}
  }
}
```

### 6.2. Resource Read (`resources/read`)

Resource reading enables clients to access external content like files, database
records, or web resources through the MCP server. This pattern is essential for
providing AI models with necessary context from external systems while
maintaining proper access controls.

#### 6.2.1. Request `mcp.resources.read.request`

```json
{
  "specversion": "1.0",
  "id": "ce-req-002",
  "source": "urn:client",
  "type": "mcp.resources.read.request",
  "data": {"uri": "file:///documents/manual.pdf"}
}
```

#### 6.2.2. Response `mcp.resources.read.response`

```json
{
  "specversion": "1.0",
  "id": "ce-res-002",
  "source": "urn:server",
  "type": "mcp.resources.read.response",
  "correlationid": "ce-req-002",
  "data": {
    "uri": "file:///documents/manual.pdf",
    "content": "<base64>",
    "mimeType": "application/pdf"
  }
}
```

### 6.3. Prompt Instantiation (`prompts/get`)

Prompt instantiation allows clients to request pre-defined prompt templates from
the server, with arguments filled in. This standardizes prompt engineering
practices and enables organizational governance over prompt content while
allowing for dynamic customization.

#### 6.3.1. Request `mcp.prompts.get.request`

```json
{
  "specversion": "1.0",
  "id": "ce-req-003",
  "source": "urn:client",
  "type": "mcp.prompts.get.request",
  "data": {
    "name": "summarizeText",
    "arguments": {"text": "Long input text..."}
  }
}
```

#### 6.3.2. Response `mcp.prompts.get.response`

```json
{
  "specversion": "1.0",
  "id": "ce-res-003",
  "source": "urn:server",
  "type": "mcp.prompts.get.response",
  "correlationid": "ce-req-003",
  "data": {
    "name": "summarizeText",
    "prompt": "Summarize the following: Long input text..."
  }
}
```

### 6.4. Sampling (`sampling/createMessage`)

Sampling enables server-initiated generation requests to the client, which is
typically hosting an AI model. This reverse flow allows external systems to
request generation from the model without embedding complex prompt engineering
logic in those systems.

#### 6.4.1. Request `mcp.sampling.createMessage.request`

```json
{
  "specversion": "1.0",
  "id": "ce-req-004",
  "source": "urn:server",
  "type": "mcp.sampling.createMessage.request",
  "data": {
    "prompt": "Write a poem about the sea.",
    "parameters": {"temperature": 0.7}
  }
}
```

#### 6.4.2. Response `mcp.sampling.createMessage.response`

```json
{
  "specversion": "1.0",
  "id": "ce-res-004",
  "source": "urn:client",
  "type": "mcp.sampling.createMessage.response",
  "correlationid": "ce-req-004",
  "data": {"message": "Ode to the endless sea..."}
}
```

### 6.5. Meta Manifest (`meta`)

The meta manifest provides capability discovery, allowing clients to learn what
tools, resources, prompts, and resource roots are available from a server. This
eliminates the need for multiple list operations and enables clients to discover
capabilities in a single request.

#### 6.5.1. Request `mcp.meta.request`

```json
{
  "specversion": "1.0",
  "id": "ce-req-005",
  "source": "urn:client",
  "type": "mcp.meta.request",
  "data": {}
}
```

#### 6.5.2. Response `mcp.meta.response`

```json
{
  "specversion": "1.0",
  "id": "ce-res-005",
  "source": "urn:server",
  "type": "mcp.meta.response",
  "correlationid": "ce-req-005",
  "data": {
    "tools": [{"name": "sendEmail", "description": "Send an email"}],
    "resources": [{"uri": "file:///manual.pdf", "name": "Manual"}],
    "prompts": [{"name": "summarizeText"}],
    "roots": [{"uri": "file:///", "name": "Root"}],
    "serverInfo": {"name": "Example MCP Server", "version": "1.0.0", "vendor": "ExampleCorp"}
  }
}
```

### 6.6. Notifications

Notifications enable servers to push updates to clients asynchronously. These
events allow for dynamic catalog updates, error reporting, and server lifecycle
management without requiring polling from clients.

Notifications are one‑way CloudEvents. They use fresh `id` values and omit
`correlationid`.

**Supported notification event types**:

- `mcp.tools.update.notification` – tool catalogue changed
- `mcp.resources.update.notification` – resource catalogue changed
- `mcp.prompts.update.notification` – prompt catalogue changed
- `mcp.server.shutdown.notification` – server is shutting down imminently
- `mcp.error.notification` – asynchronous error report

#### 6.6.1. Tool catalogue change `mcp.tools.update.notification`

```json
{
  "specversion": "1.0",
  "id": "ce-note-tools",
  "source": "urn:server",
  "type": "mcp.tools.update.notification",
  "data": {
    "changeType": "added",
    "tool": {"name": "newTool", "description": "A newly available tool"}
  }
}
```

#### 6.6.2. Resource catalogue change `mcp.resources.update.notification`

```json
{
  "specversion": "1.0",
  "id": "ce-note-resources",
  "source": "urn:server",
  "type": "mcp.resources.update.notification",
  "data": {
    "changeType": "modified",
    "uri": "file:///documents/manual.pdf"
  }
}
```

#### 6.6.3. Prompt catalogue change `mcp.prompts.update.notification`

```json
{
  "specversion": "1.0",
  "id": "ce-note-prompts",
  "source": "urn:server",
  "type": "mcp.prompts.update.notification",
  "data": {
    "changeType": "removed",
    "name": "summarizeText"
  }
}
```

#### 6.6.4. Server shutdown `mcp.server.shutdown.notification`

```json
{
  "specversion": "1.0",
  "id": "ce-note-shutdown",
  "source": "urn:server",
  "type": "mcp.server.shutdown.notification",
  "data": {"reason": "Maintenance window"}
}
```

#### 6.6.5. Error notification `mcp.error.notification`

```json
{
  "specversion": "1.0",
  "id": "ce-note-error",
  "source": "urn:server",
  "type": "mcp.error.notification",
  "data": {
    "error": "Resource not found",
    "details": {"uri": "file:///invalid/path"}
  }
}
```

## 7. Error Handling

Errors must be emitted using `mcp.error.notification` with a data payload
describing the error.

Example:

```json
{
  "specversion": "1.0",
  "id": "uuid",
  "source": "urn:server",
  "type": "mcp.error.notification",
  "data": {
    "error": "Resource not found",
    "details": {"uri": "file:///invalid/path"}
  }
}
```

## 8. Transport Bindings

This section discusses the transport binding details for MCP over CloudEvents
for different transports.

### 8.1. WebSocket Binding

WebSocket is an IETF standard that upgrades an initial HTTP request to a
long-lived, full-duplex TCP connection. Once established, both client and server
can freely exchange framed messages without the latency of repeated HTTP
handshakes—ideal for the low-latency, bidirectional flow of CloudEvents used by
MCP.

#### 8.1.1. Specification References

[RFC 6455](https://datatracker.ietf.org/doc/html/rfc6455) + [CloudEvents WebSocket Binding](https://github.com/cloudevents/spec/blob/main/cloudevents/bindings/websockets-protocol-binding.md)

#### 8.1.2. Version Requirements

WebSocket protocol as defined in RFC 6455 with the CloudEvents binding.

#### 8.1.3. Connection Setup

- **Sub-protocol**: Clients MUST use `Sec-WebSocket-Protocol: cloudevents.json` in the upgrade request.
- **Security**: Production deployments MUST use `wss://` (WebSocket Secure) protocol.

#### 8.1.4. Message Format

One CloudEvent JSON object per WebSocket frame.

#### 8.1.5. Metadata Discovery

An HTTP GET on the WebSocket URL **without** upgrade headers returns the current `meta` manifest as JSON. This allows clients to discover capabilities without establishing a persistent connection.

#### 8.1.6. Request/Response Pattern

1. Client sends a request CloudEvent through the WebSocket connection.
2. Server processes the request and sends the response CloudEvent with `correlationid` matching the request's `id`.
3. Client matches the response by `correlationid` and delivers it to the caller.

#### 8.1.7. Notifications

Server sends notification CloudEvents through the same WebSocket connection. Clients distinguish notifications from responses by the absence of a `correlationid`.

### 8.2. MQTT 5.0 Binding

MQTT 5.0 is a lightweight publish-subscribe protocol optimized for high fan-out
and constrained networks. It introduces **Response Topic** and **Correlation
Data** properties, which MCP leverages for request-response correlation while
keeping the transport entirely asynchronous and broker-mediated.

#### 8.2.1. Specification References

[OASIS MQTT Version
5.0](https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html) +
[CloudEvents MQTT
Binding](https://github.com/cloudevents/spec/blob/main/cloudevents/bindings/mqtt-protocol-binding.md)

#### 8.2.2. Topic Structure

Every MCP server owns a configurable topic prefix anywhere in the broker tree
(e.g., `my/mcpserver`). Under that prefix:

- `{prefix}/meta` — Retained topic where the server publishes its consolidated
  manifest when it initializes. The server updates this retained message
  whenever any catalogue changes. Clients simply subscribe to this topic to
  receive the current manifest on connection and all subsequent updates
  automatically, without needing to send explicit requests.
- `{prefix}/<event-type>` — Request topics mirroring MCP method names (e.g.,
  `tools/call`, `resources/read`, `prompts/get`, `sampling/createMessage`).
  Clients publish CloudEvents requests here.

#### 8.2.3. Request/Response Pattern

1. Client publishes a request CloudEvent to the server's event topic and sets
   MQTT 5 **Response Topic** to a unique client-private topic (e.g.,
   `client/resp/123`) and **Correlation Data** to the CloudEvent `id` (binary
   UUID).
2. Server processes the request and publishes the response CloudEvent to the
   supplied Response Topic, echoing the same Correlation Data.
3. Client matches the response by Correlation Data → CloudEvent `correlationid`
   mapping and delivers it to the caller.

#### 8.2.4. Notifications

Server publishes notification CloudEvents to the corresponding event topics;
clients subscribe to `{prefix}/+/+` to receive them.

#### 8.2.5. Security

Deployments MUST use `mqtts://` with TLS. The MQTT broker MAY secure the connection
using client certificates or username/password authentication. The broker MAY define
authorization policies for topic access.

## 9. References

- [MCP Core Specification](https://modelcontextprotocol.io)
- [CloudEvents Specification v1.0](https://github.com/cloudevents/spec/blob/v1.0/cloudevents/spec.md)
- [RFC 6455 - The WebSocket Protocol](https://datatracker.ietf.org/doc/html/rfc6455)
- [CloudEvents WebSocket Protocol Binding](https://github.com/cloudevents/spec/blob/main/cloudevents/bindings/websockets-protocol-binding.md)
- [OASIS MQTT Version 5.0](https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html)
- [CloudEvents MQTT Protocol Binding](https://github.com/cloudevents/spec/blob/main/cloudevents/bindings/mqtt-protocol-binding.md)

## 9. Appendix A: Meta Manifest Schema

The `meta` topic content and the HTTP GET response from the WebSocket endpoint
MUST conform to the JSON schema defined in this section. 

```json
{
  "tools": [
    {
      "name": "string",
      "description": "string",
      "inputSchema": {"type": "object"},
      "annotations": {
        "idempotentHint": true,
        "readOnlyHint": true,
        "destructiveHint": false,
        "openWorldHint": false
      }
    }
  ],
  "resources": [
    {
      "uri": "string",
      "name": "string",
      "mimeType": "string",
      "sizeBytes": 0,
      "lastModifiedEpochSeconds": 0
    }
  ],
  "prompts": [
    {
      "name": "string",
      "description": "string",
      "arguments": [
        {"name": "string", "description": "string", "required": true}
      ]
    }
  ],
  "roots": [
    {"uri": "string", "name": "string"}
  ],
  "serverInfo": {
    "name": "string",
    "version": "string",
    "vendor": "string"
  }
}
```


