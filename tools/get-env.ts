import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { ToolConfig } from "../types/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types";

const name = "get-env";
const config: ToolConfig = {
    title: "Pring Environment Tool",
    description: "Returns all env variables, helpful for debuggin MCP server configurations",
    inputSchema: {},
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
    },
};

export const registerGetEnvTool = (server: McpServer) => {
    server.registerTool(name, config, async (args: any): Promise<CallToolResult> => {
        return {
            content: [{ type: "text", text: JSON.stringify(process.env, null, 2) }],
        };
    });
};
