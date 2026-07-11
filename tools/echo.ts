import { z } from "zod";
import type { ToolConfig } from "../types/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Tool input schema
export const EchoSchema = z.object({
  message: z.string().describe("Message to echo"),
});

// Tool configuration
const name = "echo";
const config: ToolConfig = {
  title: "Echo Tool",
  description: "Echoes back the input string",
  inputSchema: EchoSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const registerEchoTool = (server: McpServer) => {
  server.registerTool(name, config, async (args: any): Promise<CallToolResult> => {
    console.log('args', args)
    const validateArgs = EchoSchema.parse(args);
    return {
      content: [{ type: "text", text: `Echo: ${validateArgs.message}` }],
    };
  });
};
