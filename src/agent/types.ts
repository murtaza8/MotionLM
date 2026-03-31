// ---------------------------------------------------------------------------
// Agent state machine
// ---------------------------------------------------------------------------

export enum AgentState {
  IDLE = "IDLE",
  THINKING = "THINKING",
  TOOL_CALL = "TOOL_CALL",
  COMPLETE = "COMPLETE",
  ERROR = "ERROR",
  PAUSED = "PAUSED",
}

// ---------------------------------------------------------------------------
// Token usage
// ---------------------------------------------------------------------------

export interface TokenUsage {
  input: number;
  output: number;
  cached: number;
}

// ---------------------------------------------------------------------------
// Message content blocks
// ---------------------------------------------------------------------------

export interface TextContentBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface ToolUseContentBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultTextContent {
  type: "text";
  text: string;
}

export interface ToolResultImageContent {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/png";
    data: string;
  };
}

export type ToolResultContent = ToolResultTextContent | ToolResultImageContent;

export interface ToolResultContentBlock {
  type: "tool_result";
  tool_use_id: string;
  content: ToolResultContent[];
  is_error?: boolean;
}

export interface ImageContentBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/png";
    data: string;
  };
  cache_control?: { type: "ephemeral" };
}

export type ContentBlock =
  | TextContentBlock
  | ToolUseContentBlock
  | ToolResultContentBlock
  | ImageContentBlock;

// ---------------------------------------------------------------------------
// Agent messages
// ---------------------------------------------------------------------------

export interface AgentMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

// ---------------------------------------------------------------------------
// AgentAction -- discriminated union yielded by the runner
// ---------------------------------------------------------------------------

export type AgentAction =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; toolName: string; toolUseId: string }
  | {
      type: "tool_call_result";
      toolName: string;
      toolUseId: string;
      result: string;
      isError?: boolean;
    }
  | {
      /** Emitted once per API turn after the full assistant response is built.
       *  Includes text and tool_use blocks for persistent history storage. */
      type: "assistant_turn";
      content: ContentBlock[];
    }
  | {
      /** Emitted after all tools in a batch have executed.
       *  Contains the tool_result blocks (including image results) so
       *  session.ts can append them to conversationHistory. This allows
       *  MessageList to pair tool_use with tool_result for display and
       *  lets ToolCallCard show captured images. */
      type: "tool_result_turn";
      content: ToolResultContentBlock[];
    }
  | { type: "state_change"; state: AgentState }
  | { type: "error"; error: string }
  | { type: "token_usage"; usage: TokenUsage };
