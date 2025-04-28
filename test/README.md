# MCP CloudEvents Bridge & Proxy Test

This directory contains test scripts for verifying the functionality of the MCP CloudEvents Bridge and Proxy components.

## test-bridge-proxy.py

A Python script that demonstrates and tests the integration between:
- An MCP server (the "everything" server from npm)
- The MCP CloudEvents Bridge (wrapping the server and exposing it via WebSocket)
- The MCP CloudEvents Proxy (connecting to the bridge)
- The MCP Inspector (testing the functionality)

### Prerequisites

Before running the test, ensure you have:

1. Python 3.6+ installed on your system

2. Built the bridge component:
   ```
   cd ../impl/bridge
   npm install
   npm run build
   ```

3. Built the proxy component:
   ```
   cd ../impl/proxy
   npm install
   npm run build
   ```

4. Installed the MCP Inspector:
   ```
   npm install -g @modelcontextprotocol/inspector
   ```

### Running the Test

To run the test:

```
python test-bridge-proxy.py
```

### What the Test Does

The test script:

1. Starts the MCP Bridge, which wraps the "everything" server from npm and exposes it via WebSocket on port 9000
2. Starts the MCP Proxy, which connects to the bridge's WebSocket endpoint
3. Runs the MCP Inspector, which connects to the proxy via stdin/stdout
4. Sends various commands to the inspector to verify functionality
5. Cleans up all processes on completion

### Expected Output

When the test runs successfully, you should see:
- Log messages from the bridge showing it started successfully
- Log messages from the proxy showing it connected to the bridge
- Output from the inspector showing the available tools, resources, and prompts from the "everything" server
- A final "Test completed successfully" message

### Troubleshooting

If the test fails:
- Check that all prerequisites are met and components are built
- Verify that port 9000 is available for the bridge to use
- Check that paths to executables are correct
- Increase wait times in the script for slower systems

### Advantages of the Python version

The Python script provides several advantages over the JavaScript version:
- More robust process handling
- Better cleanup through atexit handlers
- Cleaner threading for stdout/stderr handling
- Proper signal handling
- Type annotations and docstrings for better code readability

## test-bridge-proxy.js (Deprecated)

A JavaScript version of the same test. The Python version is recommended for better reliability.