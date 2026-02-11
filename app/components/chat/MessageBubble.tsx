import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { cn } from "~/lib/utils";
import { Bot, User } from "lucide-react";
import { ToolCallCard, type ToolCallState } from "./ToolCallCard";

export type StreamPart =
  | { type: "text"; content: string }
  | { type: "tool_call"; toolCall: ToolCallState };

interface MessageBubbleProps {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  isStreaming?: boolean;
  /** If provided, renders structured parts instead of plain content. */
  streamParts?: StreamPart[];
}

export function MessageBubble({
  role,
  content,
  isStreaming,
  streamParts,
}: MessageBubbleProps) {
  const isUser = role === "user";

  // Determine if we have any visible content
  const hasContent = streamParts
    ? streamParts.some(
        (p) => (p.type === "text" && p.content.length > 0) || p.type === "tool_call"
      )
    : content.length > 0;

  return (
    <div
      className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        )}
      >
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>

      {/* Content */}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 text-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : streamParts && streamParts.length > 0 ? (
          <div>
            {streamParts.map((part, i) =>
              part.type === "text" ? (
                part.content.length > 0 ? (
                  <div
                    key={`text-${i}`}
                    className="prose prose-sm dark:prose-invert max-w-none [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-background/50 [&_pre]:p-3 [&_code]:rounded [&_code]:bg-background/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_pre_code]:bg-transparent [&_pre_code]:p-0"
                  >
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeHighlight]}
                    >
                      {part.content}
                    </Markdown>
                  </div>
                ) : null
              ) : (
                <ToolCallCard
                  key={`tool-${part.toolCall.id}`}
                  toolCall={part.toolCall}
                />
              )
            )}
            {/* Show streaming dots if we're streaming and the last part has no content */}
            {isStreaming && !hasContent && (
              <div className="flex items-center gap-1">
                <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
              </div>
            )}
          </div>
        ) : content ? (
          <div className="prose prose-sm dark:prose-invert max-w-none [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-background/50 [&_pre]:p-3 [&_code]:rounded [&_code]:bg-background/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_pre_code]:bg-transparent [&_pre_code]:p-0">
            <Markdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
            >
              {content}
            </Markdown>
          </div>
        ) : isStreaming ? (
          <div className="flex items-center gap-1">
            <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
