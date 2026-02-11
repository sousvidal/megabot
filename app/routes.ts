import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),

  // Chat routes (nested: chat.tsx is its own layout with conversation sidebar)
  route("chat", "routes/chat.tsx", [
    index("routes/chat._index.tsx"),
    route(":id", "routes/chat.$id.tsx"),
  ]),

  // Pages that share the standard app shell (sidebar nav + content)
  layout("components/layout/Layout.tsx", [
    route("stream", "routes/stream.tsx"),
  ]),

  // API routes
  route("api/chat", "routes/api.chat.tsx"),
  route("api/inngest", "routes/api.inngest.tsx"),
] satisfies RouteConfig;
