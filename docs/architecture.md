# MegaBot — Architecture Reference

## Vision

A general-purpose, self-hosted AI personal assistant that lives on your machine and can do what you can do. Open source, plugin-based, agentic. Think Moltbot but reliable, modular, and extensible.

## Core Philosophy

- **Everything is a plugin.** The core is thin. System access, web research, code execution, integrations, memory — all plugins that register tools.
- **Reliability first.** Inngest provides durable execution, retries, scheduling, and observability. No more silent failures.
- **The bot manages itself.** It can create its own scheduled tasks, spawn agents, build workflows, and evolve its own capabilities.
- **Plugin-based communication.** Messaging platforms (WhatsApp, Telegram, Slack, etc.) are plugins. The bot isn't tied to any single interface.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend + Frontend | React Router v7 (full-stack) |
| Language | TypeScript |
| Durable Execution / Scheduling | Inngest (self-hosted) |
| Database (app) | SQLite (separate from Inngest's own DB) |
| LLM | Any model via LLM plugins — local (Ollama) or cloud (Anthropic, OpenAI, etc.) |

---

## Architecture Overview

Two parallel systems running side by side:

```
[Comm Plugins: WhatsApp, Telegram, CLI, ...]
        ↕ (fast, direct)
   [Chat Handler]  ←──model routing──→  [LLM Plugins: Anthropic, Ollama, ...]
        ↕                                       
        ├──dispatches──→  [Inngest Event API]
        ↕                        ↕
   [App SQLite DB]  ←──────  [Inngest Functions]
        ↑                    (crons, tasks, agents)
        └──────────────────────↩ (results + proactive messages via comm plugins)
```

### 1. Chat Layer (fast path)

Direct request/response through messaging plugins. User sends a message → chat handler routes to an LLM plugin via the model router → gets a response. No queue overhead.

When the LLM decides work is needed beyond a simple response, it dispatches to the Inngest event loop.

### 2. Inngest Event Loop (durable path)

The bot's autonomous nervous system. Handles:

- **Heartbeat / cron loop** — scheduled recurring tasks
- **Background tasks** — long-running work dispatched from chat
- **Agent execution** — sub-agents run as Inngest functions
- **Self-scheduled work** — tasks the bot creates for itself
- **Proactive outreach** — bot initiates contact with user via plugins when tasks complete or events occur

---

## Plugin System

Plugins are the primary extension mechanism. A plugin can provide:

- **LLM providers** (Anthropic, OpenAI, Google, Ollama, etc.)
- **Communication channels** (WhatsApp, Telegram, Slack, email, CLI)
- **Integrations** (Google Calendar, GitHub, Notion, Todoist, etc.)
- **Capabilities** (web search, code execution, file management, memory)

Each plugin registers one or more **tools** with the tool registry. LLM plugins are special — they register themselves as model providers rather than tools.

### LLM Plugin Interface

```typescript
interface LLMPlugin {
  id: string
  name: string                 // e.g. "anthropic", "ollama"
  models: ModelDefinition[]    // Available models from this provider
  chat: (params: LLMChatParams) => AsyncGenerator<LLMChunk>  // Streaming response
  supportsTools: boolean       // Whether the model supports tool calling
  supportsVision: boolean      // Whether the model supports image input
}

interface ModelDefinition {
  id: string                   // e.g. "claude-sonnet-4-5-20250929"
  name: string                 // e.g. "Claude Sonnet 4.5"
  provider: string             // e.g. "anthropic"
  tier: 'fast' | 'standard' | 'powerful'  // For model routing
  contextWindow: number
  costPerInputToken?: number   // Optional, for cost tracking
  costPerOutputToken?: number
}
```

### Model Routing

The system can have multiple LLM plugins active simultaneously. A model router decides which model handles each task based on:

- **Task tier** — safety checks → `fast`, general chat → `standard`, planning/complex reasoning → `powerful`
- **User override** — user can pin a specific model for a conversation or globally
- **Agent-specific** — each agent definition can specify a preferred model
- **Fallback chain** — if the primary model fails, fall through to alternatives

### Tool Interface

```typescript
interface Tool {
  name: string
  description: string          // Used by LLM to understand when to use this tool
  parameters: JSONSchema       // Input schema
  execute: (params: unknown, context: ToolContext) => Promise<ToolResult>
  permissions: PermissionLevel // What the user needs to have enabled
}
```

### Tool Discovery (not injection)

Tools are **not** all injected into every LLM prompt. Instead:

1. The bot has a meta-tool: `search_tools({ query: "..." })` that searches the tool registry
2. For a given task, the bot first identifies what tools it needs
3. Only relevant tools are injected for that turn or sub-agent
4. Keeps context windows lean as the tool count grows

---

## Agent Framework

The core bot is itself an agent, but it can spawn scoped child agents.

### Agent Definition

```typescript
interface AgentDefinition {
  id: string
  name: string
  prompt: string               // System prompt for this agent
  tools: string[]              // Tool names this agent has access to
  model?: string               // Optional model ID override (e.g. "anthropic:claude-sonnet-4-5")
  tier?: 'fast' | 'standard' | 'powerful'  // Or just specify a tier and let the router pick
  schedule?: string            // Optional cron expression for recurring agents
}
```

### How Agents Work

- Each agent runs as an **Inngest function**
- Agents are scoped: own system prompt + subset of tools
- Agents report back through the event loop (emit events on completion)
- The event loop delivers results to the parent bot or directly to the user via plugins

### Agent Types

- **Built-in agents** — standard agents that ship with the system (safety checker, planner, etc.)
- **Bot-created agents** — the bot can define new agents at runtime (prompt + tools + optional schedule)
- **User-created agents** — users define agents through the dashboard or conversation

### Examples

- User says "research X and write me a report" → bot spawns a research agent with web tools → agent works across multiple Inngest steps → posts results as event → bot delivers to user
- User says "monitor HackerNews for AI posts daily" → bot creates an agent definition with a cron schedule → Inngest runs it daily → results sent via plugin
- Complex task → bot spawns a planning agent and execution agent that coordinate through events

---

## Planning and Approval

For potentially multi-step tasks, the bot follows a plan-first approach:

1. **Planning phase** — The bot creates a plan outlining the steps it intends to take
2. **Approval phase** — A dedicated approval agent reviews the plan for safety, coherence, and efficiency
3. **Execution phase** — Approved plan is executed step by step (via Inngest for durability)

This prevents the bot from blindly chaining actions and gives a checkpoint before anything consequential happens. The approval agent is lightweight — it's not re-doing the planning, just validating it.

---

## System Access & Command Safety

The bot has access to the local command line with a tiered safety model:

### Always Safe (no check needed)
Read-only commands: `ls`, `cat`, `grep`, `ps`, `df`, `which`, `head`, `tail`, `wc`, `find` (read-only), `echo`, `pwd`, `whoami`, `date`, `file`, `stat`, etc.

### Always Blocked (denylist)
Destructive or dangerous patterns: `rm -rf /`, `mkfs`, `dd`, `sudo` (unless explicitly allowed), `:(){ :|:& };:`, `curl | bash`, `chmod -R 777 /`, etc.

### Gray Area (safety agent check)
Everything else gets routed to a lightweight safety-check agent:
- Uses a small/fast model (not the main expensive model)
- Evaluates: "Is this command destructive or risky given the context?"
- Returns allow/deny with reasoning
- If denied, the bot explains why and asks the user for confirmation

---

## Self-Management Tools

The bot has built-in tools to manage itself:

| Tool | Description |
|------|-------------|
| `create_cron` | Schedule a new recurring task (Inngest cron) |
| `update_cron` | Modify an existing scheduled task |
| `delete_cron` | Remove a scheduled task |
| `list_crons` | List all active scheduled tasks |
| `create_agent` | Define a new agent (prompt + tools + optional schedule) |
| `list_agents` | List all defined agents |
| `spawn_agent` | Run an agent immediately |
| `search_tools` | Search the tool registry for relevant tools |
| `create_workflow` | Define a reusable multi-step sequence |
| `dispatch_task` | Send a task to the Inngest event loop |

---

## Data Model

Separate SQLite database for the app (Inngest manages its own state).

### Core Tables (initial sketch)

- **plugins** — registered plugins and their config/status
- **tools** — tool registry (name, description, schema, plugin_id)
- **agents** — agent definitions (prompt, tools, schedule, created_by)
- **conversations** — conversation history per plugin/channel
- **tasks** — dispatched tasks and their status/results
- **crons** — bot-managed scheduled tasks
- **config** — user configuration, preferences, API keys

---

## Internal Event Bus

Every component in MegaBot emits structured events to an internal event bus. This is what powers the Stream UI, but it's also useful for logging, debugging, and inter-component communication.

```typescript
interface BotEvent {
  id: string
  timestamp: Date
  type: BotEventType
  source: string              // Plugin, agent, or system component that emitted it
  agentId?: string            // If emitted by/for a specific agent
  conversationId?: string     // If related to a conversation
  data: Record<string, unknown>
  level: 'debug' | 'info' | 'warn' | 'error'
}

type BotEventType =
  | 'message.received'        // Incoming message from a comm plugin
  | 'message.sent'            // Outgoing message through a comm plugin
  | 'llm.request'             // LLM call started
  | 'llm.response'            // LLM call completed (with token counts)
  | 'llm.error'               // LLM call failed
  | 'tool.called'             // Tool execution started
  | 'tool.result'             // Tool execution completed
  | 'tool.error'              // Tool execution failed
  | 'agent.spawned'           // Sub-agent created
  | 'agent.completed'         // Sub-agent finished
  | 'agent.error'             // Sub-agent failed
  | 'plan.created'            // Execution plan generated
  | 'plan.approved'           // Plan approved by approval agent
  | 'plan.rejected'           // Plan rejected by approval agent
  | 'task.dispatched'         // Task sent to Inngest
  | 'task.completed'          // Inngest task finished
  | 'task.failed'             // Inngest task failed
  | 'task.retrying'           // Inngest task retrying
  | 'cron.triggered'          // Scheduled cron fired
  | 'cron.created'            // Bot created a new cron
  | 'safety.check'            // Safety agent evaluated a command
  | 'system.info'             // General system events
```

The frontend Stream subscribes to this bus via WebSocket/SSE. Events are also persisted to the database for historical viewing.

---

Serves dual purpose:

### Backend
- API routes for plugin webhooks (`/api/webhooks/:plugin`)
- Inngest function endpoint (HTTP handler for Inngest to invoke functions)
- Chat handler routes
- Plugin management API

### Frontend (Dashboard)

Two primary views:

#### Chat Interface
Direct conversation with MegaBot. Standard chat UI — you message, it responds. Supports switching between communication plugins (or acts as its own built-in web chat). Shows the final, polished output of the bot's work.

#### Stream (Unified Activity Feed)
A real-time feed showing **everything** happening under the hood. All internal messages, agent activity, and bot work in one place. This includes:

- Agent spawns and completions ("🤖 Spawned research-agent for 'AI news'")
- Tool calls and results ("🔧 Called `web_search` → 12 results")
- Plan creation and approval steps ("📋 Plan approved: 3 steps")
- Inngest task dispatches and completions ("⏱️ Cron `morning-briefing` triggered")
- Cross-plugin message flow ("📩 Received WhatsApp message → 📤 Sent email response")
- Errors and retries ("⚠️ Google Calendar API 429 → retrying in 5s")
- Safety agent decisions ("🛡️ Command `docker rm` → approved")

The stream gives full transparency into MegaBot's internal reasoning and execution. It's the difference between seeing "Here's your morning briefing" in chat vs. watching it pull from your calendar, check your emails, scan your task list, summarize everything, and then deliver it.

Both views are real-time (WebSocket/SSE). The stream is filterable — by agent, by plugin, by event type, by severity.

#### Additional Dashboard Pages
- Plugin management — connect/disconnect platforms, configure API keys
- Task & cron manager — see active scheduled tasks, cancel/modify them
- Agent manager — view, create, edit agent definitions
- Tool browser — see all registered tools across plugins
- Settings — model configuration, permissions, safety settings
