import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";

/**
 * Register ther resources with the MCP server.
 * @param server
 */
export const registerResources = (server: McpServer) => {
    //     registerResourceTemplates(server);
    //     registerFileResources(server);
};

/**
 * Reads ther server instructions from the corresponding markdown file.
 * Attempts to load the content of the file located in the cocs directory.
 * If the file cannot be loaded, an error message is return instead.
 *
 * @returns {string} the content of the server instructions file, or an error message if reading fails.
 */
export function readInstructions(): string {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const filePath = join(__dirname, "..", "docs", "instructions.md");
    let instructions;

    try {
        instructions = readFileSync(filePath, "utf-8");
    } catch (e) {
        instructions = "Server instructions not loaded: " + e;
    }

    return instructions;
}
