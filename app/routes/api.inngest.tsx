import { serve } from "inngest/remix";
import { inngest } from "~/lib/inngest/client";
import { inngestFunctions } from "~/lib/inngest/functions";

const handler = serve({
  client: inngest,
  functions: inngestFunctions,
});

export { handler as loader, handler as action };
