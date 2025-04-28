#!/usr/bin/env python3
"""
Test script for MCP CloudEvents Bridge and Proxy

This script tests the bridge and proxy components by:
1. Starting the "everything" MCP server
2. Wrapping it with the bridge to expose it via WebSocket
3. Connecting to it via the proxy
4. Running the MCP inspector to verify functionality
"""

import subprocess
import os
import sys
import time
import signal
import datetime
import atexit
from pathlib import Path

# Configuration
BRIDGE_PORT = 9000
WEBSOCKET_URL = f"ws://localhost:{BRIDGE_PORT}/mcp"
LOG_PREFIX = "[TEST]"

# Track child processes to clean up on exit
child_processes = []

def log(message):
    """Helper to log messages with timestamp"""
    timestamp = datetime.datetime.now().isoformat()
    print(f"{LOG_PREFIX} {timestamp} - {message}")

def spawn_process(command, args, **kwargs):
    """Helper to spawn a child process and register for cleanup"""
    cmd_str = f"{command} {' '.join(args)}"
    log(f"Starting process: {cmd_str}")
    
    # Set default stdout/stderr handling if not provided
    if 'stdout' not in kwargs:
        kwargs['stdout'] = subprocess.PIPE
    if 'stderr' not in kwargs:
        kwargs['stderr'] = subprocess.PIPE
    
    # Start the process
    process = subprocess.Popen(
        [command] + args,
        text=True,
        **kwargs
    )
    
    # Register for cleanup
    child_processes.append(process)
    
    # Set up stdout/stderr handlers if pipes are used
    if process.stdout:
        def handle_stdout():
            for line in iter(process.stdout.readline, ''):
                if line:
                    print(f"[{command}] {line.rstrip()}")
                    
        # Start thread to read stdout
        import threading
        stdout_thread = threading.Thread(target=handle_stdout)
        stdout_thread.daemon = True
        stdout_thread.start()
    
    if process.stderr:
        def handle_stderr():
            for line in iter(process.stderr.readline, ''):
                if line:
                    print(f"[{command}] ERROR: {line.rstrip()}")
                    
        # Start thread to read stderr
        import threading
        stderr_thread = threading.Thread(target=handle_stderr)
        stderr_thread.daemon = True
        stderr_thread.start()
    
    return process

def cleanup_and_exit(code=0):
    """Clean up all child processes and exit"""
    log("Cleaning up processes...")
    
    for process in child_processes:
        try:
            process.terminate()
            # Give it some time to terminate gracefully
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            # If it doesn't terminate gracefully, kill it
            try:
                process.kill()
            except Exception as e:
                print(f"Error killing process: {e}")
    
    log("Exiting...")
    sys.exit(code)

def run_test():
    """Run the test"""
    try:
        log("Starting test for MCP CloudEvents Bridge and Proxy")
        
        # Get the current script directory
        script_dir = Path(__file__).parent.resolve()
        # Path to bridge and proxy executables
        bridge_path = script_dir.parent / "impl" / "bridge" / "dist" / "index.js"
        proxy_path = script_dir.parent / "impl" / "proxy" / "dist" / "index.js"
        
        # Step 1: Start the bridge which wraps the everything server
        log("Starting the bridge with the everything server...")
        bridge = spawn_process("node", [
            str(bridge_path),
            "--command", "npx",
            "--args", "@modelcontextprotocol/server-everything",
            "--port", str(BRIDGE_PORT),
            "--debug"
        ])
        
        # Wait for bridge to start
        log("Waiting for bridge to start...")
        time.sleep(3)
        
        # Step 2: Run the MCP inspector with the proxy to connect to the bridge
        log("Starting the MCP inspector with the proxy...")
        inspector = spawn_process("npx", [
            "@modelcontextprotocol/inspector",
            "--verbose",
            "--",
            "node", str(proxy_path),
            "--transport", "websocket",
            "--endpoint", WEBSOCKET_URL
        ], stdin=subprocess.PIPE, stdout=sys.stdout, stderr=sys.stderr)
        
        # Wait for inspector and proxy to connect
        log("Waiting for inspector and proxy to connect...")
        time.sleep(3)
        
        # Send commands to the inspector
        commands = [
            "list_tools\n",
            "list_resources\n",
            "list_prompts\n",
            "exit\n"
        ]
        
        # Send commands with a delay between them
        for command in commands:
            time.sleep(2)
            log(f"Sending command: {command.strip()}")
            inspector.stdin.write(command)
            inspector.stdin.flush()
        
        # Wait for inspector to finish
        log("Waiting for inspector to finish...")
        time.sleep(3)
        
        # Check if any processes have exited with errors
        for process in [bridge, inspector]:
            if process.poll() is not None and process.returncode != 0:
                log(f"Process exited with code {process.returncode}")
                return False
        
        log("Test completed successfully")
        return True
    
    except Exception as e:
        log(f"Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

# Register cleanup handler
atexit.register(cleanup_and_exit)

# Handle signals
def signal_handler(sig, frame):
    cleanup_and_exit()

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# Run the test and exit with appropriate code
if __name__ == "__main__":
    success = run_test()
    cleanup_and_exit(0 if success else 1)