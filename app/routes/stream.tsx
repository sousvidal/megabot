import { Activity } from "lucide-react";

export default function StreamPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Activity className="size-8" />
      </div>
      <h1 className="text-2xl font-semibold text-foreground">Stream</h1>
      <p className="max-w-md text-center text-muted-foreground">
        The unified activity feed will show everything happening under the
        hood — agent activity, tool calls, scheduled tasks, and more. Coming
        soon.
      </p>
    </div>
  );
}
