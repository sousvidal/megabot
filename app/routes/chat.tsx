import { useEffect } from "react";
import { Outlet, NavLink, useLoaderData, useRevalidator } from "react-router";
import { desc } from "drizzle-orm";
import { getServer } from "~/lib/server/init";
import { conversations } from "~/lib/db/schema";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { Plus, MessageSquare } from "lucide-react";
import { Sidebar } from "~/components/layout/Sidebar";

export function loader() {
  const server = getServer();
  const convos = server.db
    .select({
      id: conversations.id,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .orderBy(desc(conversations.updatedAt))
    .all();

  return { conversations: convos };
}

export default function ChatLayout() {
  const { conversations: convos } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  // Revalidate the conversation list when new conversations are created
  // (e.g. from spawned agents or other tabs).
  useEffect(() => {
    const eventSource = new EventSource("/api/notifications");

    eventSource.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as unknown;
        if (
          data &&
          typeof data === "object" &&
          "type" in data &&
          typeof data.type === "string" &&
          data.type === "conversation.created"
        ) {
          void revalidator.revalidate();
        }
      } catch {
        // Ignore parse errors (e.g. heartbeat comments)
      }
    };

    return () => {
      eventSource.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />

      {/* Conversation list sidebar */}
      <div className="flex h-full w-72 flex-col border-r border-border bg-sidebar">
        <div className="flex items-center justify-between p-4">
          <h2 className="text-sm font-semibold text-foreground">Conversations</h2>
          <NavLink to="/chat">
            <Button variant="ghost" size="icon-xs">
              <Plus className="size-4" />
            </Button>
          </NavLink>
        </div>
        <Separator />
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-1 p-2">
            {convos.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                No conversations yet
              </p>
            ) : (
              convos.map((convo) => (
                <NavLink
                  key={convo.id}
                  to={`/chat/${convo.id}`}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground"
                    )
                  }
                >
                  <MessageSquare className="size-4 shrink-0" />
                  <span className="truncate">
                    {convo.title || "New conversation"}
                  </span>
                </NavLink>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
