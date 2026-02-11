import pino from "pino";
import type { Logger } from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true } }
    : {
        targets: [
          { target: "pino/file", options: { destination: 1 } },
          {
            target: "pino-roll",
            options: {
              file: "./data/logs/megabot",
              frequency: "daily",
              dateFormat: "yyyy-MM-dd",
              mkdir: true,
            },
          },
        ],
      },
});

export type { Logger };
