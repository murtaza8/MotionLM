import { useEffect, useRef } from "react";
import { User, Bot } from "lucide-react";

import { useStore } from "@/store";
import { ToolCallCard } from "./ToolCallCard";

import type {
  AgentMessage,
  ContentBlock,
  ToolUseContentBlock,
  ToolResultContentBlock,
} from "@/agent/types";

// ---------------------------------------------------------------------------
// MessageList
// ---------------------------------------------------------------------------

/**
 * Renders the conversation history. Each AgentMessage is broken into its
 * content blocks: user text, agent text, tool call cards, images.
 */
export const MessageList = () => {
  const conversationHistory = useStore((s) => s.conversationHistory);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationHistory.length]);

  if (conversationHistory.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <p className="text-xs text-[var(--text-tertiary)] text-center leading-relaxed">
          Describe what you want to create or edit.
          Select an element in the preview for targeted changes.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2 flex flex-col gap-3">
      {conversationHistory.map((msg, i) => (
        <MessageBubble key={i} message={msg} allMessages={conversationHistory} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

const MessageBubble = ({
  message,
  allMessages,
}: {
  message: AgentMessage;
  allMessages: AgentMessage[];
}) => {
  const isUser = message.role === "user";

  // Skip tool_result-only user messages (these are internal runner messages)
  const hasUserVisibleContent = message.content.some(
    (b) => b.type === "text" || b.type === "image"
  );
  if (isUser && !hasUserVisibleContent) return null;

  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div
        className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 ${
          isUser
            ? "bg-blue-500/20 text-blue-300"
            : "bg-[var(--glass-bg-2)] text-[var(--text-secondary)]"
        }`}
      >
        {isUser ? (
          <User className="w-3 h-3" />
        ) : (
          <Bot className="w-3 h-3" />
        )}
      </div>

      {/* Content */}
      <div
        className={`flex flex-col gap-1.5 min-w-0 max-w-[85%] ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        {message.content.map((block, i) => (
          <BlockRenderer
            key={i}
            block={block}
            isUser={isUser}
            allMessages={allMessages}
          />
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// BlockRenderer
// ---------------------------------------------------------------------------

const BlockRenderer = ({
  block,
  isUser,
  allMessages,
}: {
  block: ContentBlock;
  isUser: boolean;
  allMessages: AgentMessage[];
}) => {
  switch (block.type) {
    case "text":
      return <TextBlock text={block.text} isUser={isUser} />;

    case "tool_use":
      return (
        <ToolUseBlockRenderer
          toolUse={block}
          allMessages={allMessages}
        />
      );

    case "tool_result":
      // Tool results are rendered via ToolCallCard paired with tool_use
      return null;

    case "image":
      return (
        <img
          src={`data:${block.source.media_type};base64,${block.source.data}`}
          alt="Agent capture"
          className="rounded max-w-full max-h-[200px] border border-[var(--glass-border-subtle)]"
        />
      );

    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// TextBlock
// ---------------------------------------------------------------------------

const TextBlock = ({ text, isUser }: { text: string; isUser: boolean }) => {
  // Filter out XML tags from context blocks (instruction tags, source files, etc.)
  const displayText = isUser ? stripContextTags(text) : text;

  if (!displayText.trim()) return null;

  return (
    <div
      className={`rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words ${
        isUser
          ? "glass-tint-blue text-[var(--text-primary)]"
          : "glass-well text-[var(--text-secondary)]"
      }`}
    >
      {displayText}
    </div>
  );
};

// ---------------------------------------------------------------------------
// ToolUseBlockRenderer
// ---------------------------------------------------------------------------

const ToolUseBlockRenderer = ({
  toolUse,
  allMessages,
}: {
  toolUse: ToolUseContentBlock;
  allMessages: AgentMessage[];
}) => {
  // Find the matching tool_result in a subsequent user message
  const toolResult = findToolResult(toolUse.id, allMessages);
  return <ToolCallCard toolUse={toolUse} toolResult={toolResult} />;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Search all messages for a tool_result block matching the given tool_use_id.
 */
function findToolResult(
  toolUseId: string,
  messages: AgentMessage[]
): ToolResultContentBlock | null {
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
        return block;
      }
    }
  }
  return null;
}

/**
 * Strip context XML tags from user messages so the display only shows the
 * actual instruction. Tags like <source-file>, <temporal-map>,
 * <selected-element>, <virtual-file-system> are context injected by the
 * context builder and not useful to display.
 */
function stripContextTags(text: string): string {
  // Remove XML block tags and their contents
  const stripped = text
    .replace(/<source-file[\s\S]*?<\/source-file>/g, "")
    .replace(/<virtual-file-system[\s\S]*?<\/virtual-file-system>/g, "")
    .replace(/<temporal-map[\s\S]*?<\/temporal-map>/g, "")
    .replace(/<selected-element[\s\S]*?<\/selected-element>/g, "")
    .replace(/<file[\s\S]*?<\/file>/g, "");

  // Extract just the instruction content
  const instructionMatch = /<instruction>([\s\S]*?)<\/instruction>/.exec(stripped);
  if (instructionMatch) return instructionMatch[1].trim();

  // Fallback: return the cleaned text
  return stripped.trim();
}
