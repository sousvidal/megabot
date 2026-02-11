import { NavLink } from "react-router";
import { cn } from "~/lib/utils";
import { MessageSquare, Activity, Settings, Bot } from "lucide-react";

const navItems = [
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/stream", label: "Stream", icon: Activity },
];

export function Sidebar() {
  return (
    <aside className="flex h-screen w-16 flex-col items-center border-r border-border bg-sidebar py-4">
      {/* Logo */}
      <div className="mb-8 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Bot className="size-5" />
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col items-center gap-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                isActive && "bg-accent text-accent-foreground"
              )
            }
          >
            <item.icon className="size-5" />
          </NavLink>
        ))}
      </nav>

      {/* Bottom */}
      <div className="flex flex-col items-center gap-2">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              "flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              isActive && "bg-accent text-accent-foreground"
            )
          }
        >
          <Settings className="size-5" />
        </NavLink>
      </div>
    </aside>
  );
}
