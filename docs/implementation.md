# MegaBot — Implementation Status

Current state of what's built, how it works, and what's next.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Full-stack framework | React Router v7 |
| Language | TypeScript |
| Database | SQLite via Drizzle ORM + better-sqlite3 |
| LLM SDK | @anthropic-ai/sdk |
| Background tasks | Inngest (scaffolded, not yet wired) |
| UI | Tailwind CSS + Shadcn (New York, neutral) |
| Markdown | react-markdown + remark-gfm + rehype-highlight |

---

## Project Structure

```
app/
├── components/
│   ├── chat/
│   │   ├── ChatWindow.tsx        # Main chat UI with SSE streaming + tool call handling
│   │   ├── MessageBubble.tsx     # Message rendering (text, markdown, tool cards)
│   │   └── ToolCallCard.tsx      # Collapsible tool call display component
│   ├── layout/
│   │   ├── Layout.tsx            # App shell
│   │   └── Sidebar.tsx           # Navigation sidebar (Chat, Stream, Settings)
│   └── ui/                       # Shadcn primitives (button, avatar, input, etc.)
├── lib/
│   ├── core/
│   │   ├── chat-handler.ts       # Chat handler with tool-call loop
│   │   ├── event-bus.ts          # Internal event bus
│   │   ├── model-router.ts       # LLM model routing by tier/ID
│   │   ├── plugin-registry.ts    # Plugin registration and lookup
│   │   ├── system-prompt.ts      # System prompt generation
│   │   └── tool-registry.ts      # Tool registration, search, and execution
│   ├── db/
│   │   ├── index.ts              # Database creation + schema push
│   │   └── schema.ts             # Drizzle table definitions
│   ├── inngest/
│   │   ├── client.ts             # Inngest client
│   │   └── functions/            # Background task definitions (placeholder)
│   ├── plugins/
│   │   └── anthropic/index.ts    # Anthropic LLM plugin with tool calling support
│   ├── server/
│   │   └── init.ts               # Server singleton: registers plugins + tools
│   ├── tools/
│   │   ├── index.ts              # Tool re-exports
│   │   ├── get-current-time.ts   # get_current_time tool
│   │   ├── search-tools.ts       # search_tools meta-tool
│   │   ├── web-fetch.ts          # web_fetch tool
│   │   ├── run-command.ts        # run_command tool (allowlisted commands)
│   │   └── memory.ts             # memory_store + memory_recall tools
│   ├── types/
│   │   ├── llm.ts                # LLM types: messages, content blocks, chunks
│   │   ├── plugin.ts             # Plugin interfaces (LLM, Comm, Tool)
│   │   ├── tool.ts               # Tool interface + context/result types
│   │   ├── event.ts              # Event bus types
│   │   └── agent.ts              # Agent definition types
│   └── utils.ts                  # Tailwind cn() helper
└── routes/
    ├── _index.tsx                # / — redirects to /chat
    ├── chat.tsx                  # /chat — layout with conversation sidebar
    ├── chat._index.tsx           # /chat — new conversation landing
    ├── chat.$id.tsx              # /chat/:id — conversation view
    ├── stream.tsx                # /stream — activity feed (placeholder)
    ├── api.chat.tsx              # POST /api/chat — streaming chat endpoint
    └── api.inngest.tsx           # Inngest webhook handler
```

---

## Core Systems

### Plugin System

Plugins register with the `PluginRegistry` by type: `llm`, `comm`, or `tool`. Each plugin type has its own interface.

**Implemented plugins:**
- **Anthropic** — LLM plugin with 3 models (Haiku = fast, Sonnet = standard, Opus = powerful). Supports tool calling and vision.

**Not yet implemented:**
- Communication plugins (WhatsApp, Telegram, etc.)
- Additional LLM plugins (OpenAI, Ollama)
- Integration plugins (Google Calendar, GitHub, etc.)

### Model Router

Routes LLM requests to the right provider and model:
1. Specific model ID (`anthropic:claude-sonnet-4-5-20250929`)
2. Tier-based (`fast`, `standard`, `powerful`)
3. Fallback to first available model

### Tool Registry

Central registry for all tools. Supports `register`, `get`, `getAll`, `search` (substring match on name/description), and `execute` (with error handling).

Tools are provider-agnostic — they register once and work with any LLM plugin that supports tool calling.

---

## Tool Calling

The full tool calling pipeline is implemented end-to-end.

### Flow

```
User message
    ↓
ChatHandler.handle()
    ↓
Load history (with ContentBlock deserialization)
    ↓
Route to LLM model
    ↓
┌─────────────────────────────────────┐
│  LLM Call Loop (no iteration limit) │
│                                     │
│  1. Call LLM with tools + history   │
│  2. Stream response to frontend     │
│  3. If tool_calls_pending:          │
│     a. Execute each tool            │
│     b. Yield results to frontend    │
│     c. Append to message history    │
│     d. → Go to 1                    │
│  4. If no tool calls: break         │
└─────────────────────────────────────┘
    ↓
Persist final message + emit events
    ↓
Yield done with accumulated token usage
```

### Content Block System

`LLMMessage.content` supports both `string` (plain text) and `ContentBlock[]` (structured):

- **TextBlock** — `{ type: "text", text: string }`
- **ToolUseBlock** — `{ type: "tool_use", id: string, name: string, input: Record<string, unknown> }`
- **ToolResultBlock** — `{ type: "tool_result", toolUseId: string, content: string, isError?: boolean }`

This allows conversation history to properly replay tool call sequences when continuing a conversation.

### SSE Chunk Types

The chat endpoint streams these event types to the frontend:

| Chunk Type | Purpose |
|------------|---------|
| `meta` | Conversation ID (first event) |
| `text` | Streamed text content |
| `tool_call_start` | LLM is calling a tool (name + ID) |
| `tool_call_delta` | Partial tool arguments (streaming JSON) |
| `tool_call_end` | Complete tool call with final arguments |
| `tool_executing` | Tool is being executed server-side |
| `tool_result` | Tool execution result (content + isError) |
| `done` | Stream complete with token usage |
| `error` | Error occurred |

### Anthropic Plugin — Tool Mapping

The Anthropic plugin handles bidirectional mapping:

**Outbound:** `LLMToolDefinition[]` → Anthropic `tools` format; `ContentBlock[]` → Anthropic content blocks (text, tool_use, tool_result).

**Inbound:** Stream events → LLMChunk types. Accumulates `input_json_delta` per tool call ID to produce complete arguments on `tool_call_end`.

---

## Registered Tools

| Tool | Permissions | Description |
|------|-------------|-------------|
| `get_current_time` | none | Returns current date/time. Accepts optional IANA timezone. |
| `search_tools` | none | Searches the tool registry by keyword. Returns matching names + descriptions. |
| `web_fetch` | read | Fetches a URL and returns text content. 15s timeout, 50k char default max. |
| `run_command` | read | Executes allowlisted shell commands. Blocks dangerous patterns (redirects, substitution, chaining). 30s timeout, 50k output cap. |
| `memory_store` | write | Stores a key-value pair in the config table (persists across conversations). |
| `memory_recall` | read | Searches stored memories by key substring. |

### run_command Allowlist

`ls`, `cat`, `head`, `tail`, `grep`, `rg`, `find`, `wc`, `echo`, `pwd`, `whoami`, `date`, `file`, `stat`, `which`, `ps`, `df`, `du`, `uname`, `uptime`, `hostname`, `env`, `printenv`, `tree`, `sort`, `uniq`, `cut`, `awk`, `sed`, `tr`, `diff`, `md5sum`, `shasum`, `sha256sum`, `base64`, `jq`, `curl`, `wget`

Piped commands are supported — each command in the pipeline is checked against the allowlist. Dangerous patterns (redirects, backtick subshells, `$(...)`, `;`, `&&`, `||`) are blocked.

---

## Frontend

### Chat UI

The chat interface at `/chat/:id` provides:

- **Streaming responses** via SSE from `POST /api/chat`
- **Tool call cards** rendered inline within assistant messages, showing:
  - Status (calling → executing → done/failed) with animated spinner
  - Tool name and formatted arguments (collapsible)
  - Execution result (collapsible, truncated at 2000 chars)
  - Error styling for failed tools
- **Markdown rendering** with syntax highlighting, GFM tables, code blocks
- **Conversation sidebar** listing previous conversations
- **Auto-scroll** to bottom on new content
- **Dark mode** via `prefers-color-scheme`

### Stream Page

Placeholder at `/stream`. The EventBus emits structured events (`tool.called`, `tool.result`, `llm.request`, `llm.response`, etc.) on the backend, but the frontend doesn't subscribe to them yet.

---

## Database

SQLite database with 8 tables:

| Table | Purpose |
|-------|---------|
| `conversations` | Chat conversations with title and timestamps |
| `messages` | Message history; `tool_calls` column stores serialized ContentBlock[] |
| `plugins` | Registered plugin metadata and config |
| `tools` | Tool registry entries (DB-backed, currently unused — tools register in-memory) |
| `agents` | Agent definitions with prompt, tools, model, schedule |
| `tasks` | Dispatched task tracking |
| `events` | Persisted event log |
| `config` | Key-value store (used by memory tools) |

Tables are created automatically via raw SQL on startup (no migration step needed for dev).

---

## What's Not Yet Implemented

Per the architecture doc, these are planned but not built:

- **Communication plugins** — WhatsApp, Telegram, Slack, email, CLI
- **Additional LLM plugins** — OpenAI, Google, Ollama (local)
- **Integration plugins** — Google Calendar, GitHub, Notion, Todoist
- **Agent framework** — Types exist, but spawning/executing agents as Inngest functions isn't wired
- **Inngest event loop** — Client and handler exist, background task is a placeholder
- **Planning and approval** — Plan-first approach with approval agent
- **Command safety agent** — Gray-area commands routed to a lightweight safety-check model
- **Self-management tools** — `create_cron`, `update_cron`, `create_agent`, `spawn_agent`, `dispatch_task`, etc.
- **Stream activity feed** — EventBus exists but frontend subscription (WebSocket/SSE) not built
- **Settings page** — Sidebar links to it, route doesn't exist
- **Tool discovery mode** — `search_tools` exists but the "only inject relevant tools per turn" pattern isn't implemented; currently all tools are injected every call
