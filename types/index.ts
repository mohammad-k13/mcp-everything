import type {
  AnySchema,
  ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types";

export type ToolConfig = {
  title?: string;
  description?: string;
  inputSchema?: AnySchema | ZodRawShapeCompat | undefined;
  outputSchema?: AnySchema | ZodRawShapeCompat | undefined;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
};
