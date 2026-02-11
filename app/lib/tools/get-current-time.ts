import type { Tool } from "~/lib/types";

export const getCurrentTimeTool: Tool = {
  name: "get_current_time",
  description:
    "Returns the current date and time with timezone information. Useful when you need to know what time it is, calculate deadlines, or include timestamps.",
  parameters: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description:
          'IANA timezone string (e.g. "America/New_York", "Europe/Amsterdam"). Defaults to system timezone.',
      },
    },
    required: [],
  },
  permissions: "none",

  async execute(params) {
    const { timezone } = params as { timezone?: string };

    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "long",
    };

    if (timezone) {
      options.timeZone = timezone;
    }

    const formatted = now.toLocaleString("en-US", options);
    const iso = now.toISOString();

    return {
      success: true,
      data: `${formatted} (ISO: ${iso})`,
    };
  },
};
