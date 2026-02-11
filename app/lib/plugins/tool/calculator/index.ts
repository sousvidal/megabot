import type { Tool, ToolPlugin } from "~/lib/types";
import type { Logger } from "~/lib/logger";

/**
 * Safe mathematical expression evaluator.
 * Uses Function constructor with strict allowlist to prevent code injection.
 */
function evaluateExpression(expression: string): number {
  // Remove whitespace
  const cleaned = expression.replace(/\s+/g, "");

  // Validate: only allow numbers, operators, parentheses, and Math functions
  const allowedPattern =
    /^[0-9+\-*/.()%,\s]*(Math\.(abs|acos|asin|atan|atan2|ceil|cos|exp|floor|log|max|min|pow|random|round|sin|sqrt|tan|PI|E))?[0-9+\-*/.()%,\s]*$/;

  if (!allowedPattern.test(expression)) {
    throw new Error(
      "Invalid expression: only numbers, basic operators (+, -, *, /, %, ^), parentheses, and Math functions are allowed"
    );
  }

  // Replace ^ with ** for exponentiation (JavaScript syntax)
  const jsExpression = expression.replace(/\^/g, "**");

  // Create a safe evaluation context
  try {
    // Use Function constructor with Math context
    const evaluator = new Function(
      "Math",
      `"use strict"; return (${jsExpression});`
    );
    const result = evaluator(Math);

    if (typeof result !== "number" || !isFinite(result)) {
      throw new Error("Result is not a valid finite number");
    }

    return result;
  } catch (err) {
    throw new Error(
      `Evaluation error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

const calculateTool: Tool = {
  name: "calculate",
  description:
    "Perform mathematical calculations. Supports basic arithmetic operations (+, -, *, /, %, ^), parentheses for grouping, and Math functions (sin, cos, sqrt, pow, log, abs, round, etc.). Examples: '2 + 2', '(5 * 3) - 8', 'Math.sqrt(16)', 'Math.pow(2, 8)', '2^8'.",
  keywords: [
    "math",
    "arithmetic",
    "calculator",
    "compute",
    "evaluate",
    "expression",
    "numbers",
  ],
  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description:
          "The mathematical expression to evaluate. Examples: '2 + 2', '(10 - 3) * 2', 'Math.sqrt(144)', '2^10'",
      },
    },
    required: ["expression"],
  },
  permissions: "none",

  execute(params) {
    const { expression } = params as { expression: string };

    if (!expression || expression.trim().length === 0) {
      return {
        success: false,
        error: "Expression cannot be empty",
      };
    }

    try {
      const result = evaluateExpression(expression);
      return {
        success: true,
        data: `${expression} = ${result}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Calculation failed";
      return {
        success: false,
        error: message,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createCalculatorPlugin(logger: Logger): ToolPlugin {
  const log = logger.child({ plugin: "calculator" });

  return {
    id: "calculator",
    name: "Calculator",
    type: "tool",
    description: "Mathematical expression evaluator and calculator",
    tools: [calculateTool],
    afterToolCall: (_toolName, params, _context, result) => {
      const { expression } = params as { expression?: string };
      if (result.success) {
        log.debug({ expression, result: result.data }, "Calculation successful");
      } else {
        log.warn({ expression, error: result.error }, "Calculation failed");
      }
    },
  };
}
