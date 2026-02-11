import { runAgent } from "./run-agent";
import { runScheduler, runScheduledTask } from "./run-scheduler";

export const inngestFunctions = [runAgent, runScheduler, runScheduledTask];
