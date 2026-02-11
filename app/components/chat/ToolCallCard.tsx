import { useState } from "react";
import { cn } from "~/lib/utils";
import {
  Wrench,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

export interface ToolCallState {
  id: string;
  name: string;
  args: string;
  status: "calling" | "executing" | "done";
  result?: {
    content: string;
    isError: boolean;
  };
}

interface ToolCallCardProps {
  toolCall: ToolCallState;
  defaultExpanded?: boolean;
}

export function ToolCallCard({
  toolCall,
  defaultExpanded = false,
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { name, args, status, result } = toolCall;

  const isDone = status === "done";
  const isError = result?.isError ?? false;

  return (
    <div
      className={cn(
        "my-2 rounded-lg border text-xs",
        isError
          ? "border-destructive/30 bg-destructive/5"
          : "border-border bg-background/50"
      )}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 rounded-lg transition-colors"
      >
        {/* Status icon */}
        {status === "calling" || status === "executing" ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : isError ? (
          <XCircle className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
        )}

        {/* Tool icon + name */}
        <Wrench className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-mono font-medium text-foreground">{name}</span>

        {/* Status label */}
        <span className="text-muted-foreground">
          {status === "calling"
            ? "calling..."
            : status === "executing"
              ? "executing..."
              : isError
                ? "failed"
                : "done"}
        </span>

        {/* Expand chevron */}
        <span className="ml-auto">
          {expanded ? (
            <ChevronDown className="size-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground" />
          )}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          {/* Arguments */}
          {args && args !== "{}" && (
            <div>
              <div className="mb-1 font-medium text-muted-foreground">
                Arguments
              </div>
              <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-[11px] text-foreground">
                {formatJson(args)}
              </pre>
            </div>
          )}

          {/* Result */}
          {isDone && result && (
            <div>
              <div className="mb-1 font-medium text-muted-foreground">
                Result
              </div>
              <pre
                className={cn(
                  "overflow-x-auto rounded p-2 text-[11px] whitespace-pre-wrap wrap-break-word",
                  isError
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted/50 text-foreground"
                )}
              >
                {result.content.length > 2000
                  ? `${result.content.slice(0, 2000)}\n... [truncated]`
                  : result.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
