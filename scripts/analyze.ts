import { Project, SyntaxKind, ts, type SourceFile, type Node } from "ts-morph";
import path from "node:path";

// ── Configuration ──────────────────────────────────────────────────────────────

const THRESHOLDS = {
  fileLoc: { warn: 300, error: 500 },
  functionLoc: { warn: 50, error: 100 },
  complexity: { warn: 10, error: 20 },
  nestingDepth: { warn: 4, error: 6 },
  parameters: { warn: 5, error: 8 },
  exports: { warn: 10, error: 20 },
} as const;

const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/.react-router/**",
  "**/build/**",
  "**/dist/**",
];

// ── Types ──────────────────────────────────────────────────────────────────────

type Severity = "warning" | "error";

interface Issue {
  file: string;
  line?: number;
  severity: Severity;
  rule: string;
  message: string;
}

// ── ANSI colors ────────────────────────────────────────────────────────────────

const color = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function severity(value: number, threshold: { warn: number; error: number }): Severity | null {
  if (value > threshold.error) return "error";
  if (value > threshold.warn) return "warning";
  return null;
}

function getFunctionName(node: Node): string {
  if (node.isKind(SyntaxKind.FunctionDeclaration) || node.isKind(SyntaxKind.MethodDeclaration)) {
    return node.getName() ?? "<anonymous>";
  }
  if (node.isKind(SyntaxKind.ArrowFunction) || node.isKind(SyntaxKind.FunctionExpression)) {
    const parent = node.getParent();
    if (parent?.isKind(SyntaxKind.VariableDeclaration)) {
      return parent.getName();
    }
    if (parent?.isKind(SyntaxKind.PropertyAssignment)) {
      return parent.getName();
    }
    return "<anonymous>";
  }
  return "<unknown>";
}

function getLineCount(node: Node): number {
  return node.getEndLineNumber() - node.getStartLineNumber() + 1;
}

// ── Complexity calculator ──────────────────────────────────────────────────────

const COMPLEXITY_NODES = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.ConditionalExpression,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CaseClause,
  SyntaxKind.CatchClause,
]);

const COMPLEXITY_OPERATORS = new Set([
  SyntaxKind.BarBarToken,
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.QuestionQuestionToken,
]);

function calculateComplexity(node: Node): number {
  let complexity = 1; // base complexity

  node.forEachDescendant((child) => {
    if (COMPLEXITY_NODES.has(child.getKind())) {
      complexity++;
    }

    // Check binary expressions for logical operators
    if (child.isKind(SyntaxKind.BinaryExpression)) {
      const op = child.getOperatorToken().getKind();
      if (COMPLEXITY_OPERATORS.has(op)) {
        complexity++;
      }
    }
  });

  return complexity;
}

// ── Nesting depth calculator ───────────────────────────────────────────────────

const NESTING_NODES = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.SwitchStatement,
  SyntaxKind.TryStatement,
  SyntaxKind.ArrowFunction,
  SyntaxKind.FunctionExpression,
]);

function calculateMaxNesting(node: Node): number {
  let maxDepth = 0;

  function walk(current: Node, depth: number) {
    if (NESTING_NODES.has(current.getKind())) {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
    }
    current.forEachChild((child) => walk(child, depth));
  }

  node.forEachChild((child) => walk(child, 0));
  return maxDepth;
}

// ── Analyzers ──────────────────────────────────────────────────────────────────

function checkFileLoc(file: SourceFile, filePath: string): Issue[] {
  const issues: Issue[] = [];
  const loc = file.getEndLineNumber();
  const sev = severity(loc, THRESHOLDS.fileLoc);
  if (sev) {
    issues.push({
      file: filePath,
      severity: sev,
      rule: "file-loc",
      message: `File has ${loc} lines (threshold: ${sev === "error" ? THRESHOLDS.fileLoc.error : THRESHOLDS.fileLoc.warn})`,
    });
  }
  return issues;
}

function checkExports(file: SourceFile, filePath: string): Issue[] {
  const issues: Issue[] = [];
  const exports = file.getExportedDeclarations();
  const count = exports.size;
  const sev = severity(count, THRESHOLDS.exports);
  if (sev) {
    issues.push({
      file: filePath,
      severity: sev,
      rule: "god-file",
      message: `File has ${count} exports (threshold: ${sev === "error" ? THRESHOLDS.exports.error : THRESHOLDS.exports.warn})`,
    });
  }
  return issues;
}

interface FunctionLikeNode {
  node: Node;
  name: string;
  line: number;
  paramCount: number;
}

function collectFunctions(file: SourceFile): FunctionLikeNode[] {
  const functions: FunctionLikeNode[] = [];

  // Top-level function declarations
  for (const fn of file.getFunctions()) {
    functions.push({
      node: fn,
      name: getFunctionName(fn),
      line: fn.getStartLineNumber(),
      paramCount: fn.getParameters().length,
    });
  }

  // Class methods
  for (const cls of file.getClasses()) {
    for (const method of cls.getMethods()) {
      functions.push({
        node: method,
        name: `${cls.getName() ?? "<class>"}.${method.getName()}`,
        line: method.getStartLineNumber(),
        paramCount: method.getParameters().length,
      });
    }
    for (const ctor of cls.getConstructors()) {
      functions.push({
        node: ctor,
        name: `${cls.getName() ?? "<class>"}.constructor`,
        line: ctor.getStartLineNumber(),
        paramCount: ctor.getParameters().length,
      });
    }
  }

  // Arrow functions and function expressions assigned to variables
  for (const varDecl of file.getVariableDeclarations()) {
    const init = varDecl.getInitializer();
    if (init?.isKind(SyntaxKind.ArrowFunction) || init?.isKind(SyntaxKind.FunctionExpression)) {
      functions.push({
        node: init,
        name: varDecl.getName(),
        line: init.getStartLineNumber(),
        paramCount: init.isKind(SyntaxKind.ArrowFunction)
          ? init.getParameters().length
          : init.getParameters().length,
      });
    }
  }

  return functions;
}

function checkFunctions(file: SourceFile, filePath: string): Issue[] {
  const issues: Issue[] = [];
  const functions = collectFunctions(file);

  for (const fn of functions) {
    // Function LOC
    const loc = getLineCount(fn.node);
    const locSev = severity(loc, THRESHOLDS.functionLoc);
    if (locSev) {
      issues.push({
        file: filePath,
        line: fn.line,
        severity: locSev,
        rule: "function-loc",
        message: `Function "${fn.name}" has ${loc} lines (threshold: ${locSev === "error" ? THRESHOLDS.functionLoc.error : THRESHOLDS.functionLoc.warn})`,
      });
    }

    // Cyclomatic complexity
    const complexity = calculateComplexity(fn.node);
    const complexitySev = severity(complexity, THRESHOLDS.complexity);
    if (complexitySev) {
      issues.push({
        file: filePath,
        line: fn.line,
        severity: complexitySev,
        rule: "complexity",
        message: `Function "${fn.name}" has cyclomatic complexity of ${complexity} (threshold: ${complexitySev === "error" ? THRESHOLDS.complexity.error : THRESHOLDS.complexity.warn})`,
      });
    }

    // Nesting depth
    const nesting = calculateMaxNesting(fn.node);
    const nestingSev = severity(nesting, THRESHOLDS.nestingDepth);
    if (nestingSev) {
      issues.push({
        file: filePath,
        line: fn.line,
        severity: nestingSev,
        rule: "nesting-depth",
        message: `Function "${fn.name}" has nesting depth of ${nesting} (threshold: ${nestingSev === "error" ? THRESHOLDS.nestingDepth.error : THRESHOLDS.nestingDepth.warn})`,
      });
    }

    // Parameter count
    const paramSev = severity(fn.paramCount, THRESHOLDS.parameters);
    if (paramSev) {
      issues.push({
        file: filePath,
        line: fn.line,
        severity: paramSev,
        rule: "too-many-params",
        message: `Function "${fn.name}" has ${fn.paramCount} parameters (threshold: ${paramSev === "error" ? THRESHOLDS.parameters.error : THRESHOLDS.parameters.warn})`,
      });
    }
  }

  return issues;
}

// ── Main analysis ──────────────────────────────────────────────────────────────

function analyzeFile(file: SourceFile, filePath: string): Issue[] {
  return [
    ...checkFileLoc(file, filePath),
    ...checkExports(file, filePath),
    ...checkFunctions(file, filePath),
  ];
}

function printReport(issues: Issue[]): void {
  if (issues.length === 0) {
    console.log(color.green("\n  ✓ No issues found\n"));
    return;
  }

  // Group by file
  const grouped = new Map<string, Issue[]>();
  for (const issue of issues) {
    const existing = grouped.get(issue.file) ?? [];
    existing.push(issue);
    grouped.set(issue.file, existing);
  }

  console.log("");

  for (const [file, fileIssues] of grouped) {
    console.log(color.bold(`  ${file}`));
    for (const issue of fileIssues) {
      const sevLabel =
        issue.severity === "error"
          ? color.red("ERROR")
          : color.yellow("WARN ");
      const lineStr = issue.line ? color.dim(`:${issue.line}`) : "";
      const ruleStr = color.dim(`[${issue.rule}]`);
      console.log(`    ${sevLabel} ${ruleStr} ${issue.message}${lineStr}`);
    }
    console.log("");
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;

  const parts: string[] = [];
  if (errors > 0) parts.push(color.red(`${errors} error${errors !== 1 ? "s" : ""}`));
  if (warnings > 0) parts.push(color.yellow(`${warnings} warning${warnings !== 1 ? "s" : ""}`));

  console.log(`  ${parts.join(", ")} found\n`);
}

// ── CLI ────────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const warnOnly = args.includes("--warn-only");
  const fileArgs = args.filter((a) => !a.startsWith("--"));

  const projectRoot = path.resolve(import.meta.dirname, "..");

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: false,
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  });

  if (fileArgs.length > 0) {
    for (const f of fileArgs) {
      const resolved = path.resolve(f);
      project.addSourceFileAtPath(resolved);
    }
  } else {
    project.addSourceFilesAtPaths([
      path.join(projectRoot, "app/**/*.{ts,tsx}"),
      ...IGNORE_PATTERNS.map((p) => `!${p}`),
    ]);
  }

  const sourceFiles = project.getSourceFiles();

  if (sourceFiles.length === 0) {
    console.log(color.yellow("\n  No source files found to analyze.\n"));
    process.exit(0);
  }

  console.log(color.dim(`\n  Analyzing ${sourceFiles.length} file${sourceFiles.length !== 1 ? "s" : ""}...\n`));

  const allIssues: Issue[] = [];

  for (const file of sourceFiles) {
    const relativePath = path.relative(projectRoot, file.getFilePath());
    const issues = analyzeFile(file, relativePath);
    allIssues.push(...issues);
  }

  printReport(allIssues);

  const hasErrors = allIssues.some((i) => i.severity === "error");

  if (hasErrors && !warnOnly) {
    console.log(color.red("  Commit blocked: fix errors above before committing.\n"));
    process.exit(1);
  }
}

main();
