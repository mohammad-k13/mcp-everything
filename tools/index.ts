import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

/**
 * Register the tools with the MCP server.
 * @param server
 */
export const registerTools = (server: McpServer) => {};

/**
 * Register the tools that are conditional upon client capabilities.
 * These must be registered conditionally, after initialization.
 */
export const registerConditionalTools = (server: McpServer) => {};
