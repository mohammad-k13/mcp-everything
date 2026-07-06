import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { readInstructions, registerResources } from "../resources/index.js";
import {
    InMemoryTaskMessageQueue,
    InMemoryTaskStore,
} from "@modelcontextprotocol/sdk/experimental";
import { registerPrompts } from "../prompts/index.js";
import { registerConditionalTools, registerTools } from "../tools/index.js";
import { syncRoots } from "./roots.js";

// Server Factory response
export type ServerFactoryResponse = {
    server: McpServer;
    cleanup: () => void;
};

/**
 * Server Factory
 *
 * This function initializes a `MCPServer` with specific capabilities and instructions,
 * registers tools, resources and prompts, and configures resource subscription handlers.
 *
 * @returns {ServerFactoryResponse} An object containing ther server instance and a `cleanup`
 * function for hanlding server-side cleanup whena session ends.
 *
 * Properties of the returend object:
 * - `server`: The `MCPServer` instance.`
 * - `cleanup` {Function}: Function to preform cleanup operations for a closing session.
 */
export const createServer: () => ServerFactoryResponse = () => {
    // Read the server instructsions
    const instructions = readInstructions();

    // Create task store and message queue for task support
    const taskStore = new InMemoryTaskStore();
    const taskMessageQueue = new InMemoryTaskMessageQueue();

    let initializeTimeout: NodeJS.Timeout | null = null;

    // Create the server
    const server = new McpServer(
        {
            name: "mcp-server/everything",
            title: "Everythig Refrence Server",
            version: "1.0.0",
        },
        {
            capabilities: {
                tools: {
                    listChanged: true,
                },
                prompts: {
                    listChanged: true,
                },
                resources: {
                    subscribe: true,
                    listChanged: true,
                },
                logging: {},
                tasks: {
                    list: {},
                    cancel: {},
                    requests: {
                        tools: {
                            call: {},
                        },
                    },
                },
            },
            instructions,
            taskStore,
            taskMessageQueue,
        },
    );

    // Register the tools
    registerTools(server);

    // Register the resources
    registerResources(server);

    // Register the prompts
    registerPrompts(server);

    // Set resource subscription handlers
    //   setSubscriptionHandlers(server);

    server.server.oninitialized = async () => {
        // Register conditional tools now that client capabilities are known.
        // This finishes before the `notifications/initialized` handler finishes.
        registerConditionalTools(server);

        // Sync roots if the client supports them.
        // This is deplayed until after the `notifications/initialized` hanlder finisheds,
        // otherwise, the request gets lost.
        const sessionId = server.server.transport?.sessionId;
        initializeTimeout = setTimeout(() => syncRoots(server, sessionId), 350);
    };

    return {
        server,
        cleanup: (sessionId?: string) => {
            // Stop any simulated logging or resource updates that may have been initiated.
            // stopSimulatedLogging(sessionId);
            // stopSimulatedResourceUpdates(sessionId);

            // Clea up task store timesrs
            taskStore.cleanup();
            if (initializeTimeout) clearTimeout(initializeTimeout);
        },
    };
};
