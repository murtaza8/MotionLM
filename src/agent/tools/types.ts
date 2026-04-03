// ---------------------------------------------------------------------------
// Tool result
// ---------------------------------------------------------------------------

export type ToolResult =
  | { type: "text"; text: string }
  | { type: "image"; media_type: "image/png"; data: string };

// ---------------------------------------------------------------------------
// AgentTool interface
// ---------------------------------------------------------------------------

export interface AgentTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (input: unknown) => Promise<ToolResult>;
}
