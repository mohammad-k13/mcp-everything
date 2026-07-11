import z, { iso } from "zod";
import type { ToolConfig } from "../types/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types";
import {
    textResource,
    textResourceUri,
    blobResourceUri,
    blobResource,
} from "../resources/templates.js";

// Tool input schema
const GetResourceLinksSchema = z.object({
    count: z
        .number()
        .min(1)
        .max(10)
        .default(3)
        .describe("Number of resource links to return (1 - 10)"),
});

// Tool configuration
const name = "get-resource-links";
const config: ToolConfig = {
    title: "Get Resource Links Tool",
    description:
        "Returns up to ten resource links that reference different types of resources",
    inputSchema: GetResourceLinksSchema,
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
    },
};

export const registerGetResourceLInksTool = (server: McpServer) => {
    server.registerTool(name, config, async (args: any): Promise<CallToolResult> => {
        const { count } = GetResourceLinksSchema.parse(args);

        // Add intro text content block
        const content: CallToolResult["content"] = [];
        content.push({
            type: "text",
            text: `Here are ${count} resource links to resources availble in this server`,
        });

        // Create resource link content blocks
        for (let resourceId = 1; resourceId <= count; resourceId++) {
            // Get resource uri for text or blob resource based on odd/even resourceId
            const isOdd = resourceId % 2 === 0;
            const uri = isOdd ? textResourceUri(resourceId) : blobResourceUri(resourceId);

            // Get resource based on the resource type
            const resource = isOdd
                ? textResource(uri, resourceId)
                : blobResource(uri, resourceId);

            content.push({
                type: "resource_link",
                uri: resource.uri,
                name: `${isOdd ? "Text" : "Blob"} Resource ${resourceId}`,
                description: `Resource ${resourceId}: ${
                    resource.mimeType === "text/plain"
                        ? "plaintext resource"
                        : "binary blob resource"
                }`,
                mimeType: resource.mimeType,
            });
        }

        return { content };
    });
};
