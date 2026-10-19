import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * S-2 guard. Server action IDs can be POSTed to any route, including the public /login, so
 * the proxy does not protect them: every server action must check the session itself.
 *
 * Scans every source file with a "use server" directive and asserts that each server action
 * (every export of a file-level "use server" module, and every function with its own
 * "use server" directive) starts with an unconditional `await requireSession()`. The only
 * exception is the sign-in action, which by definition runs without a session.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** Keyed by file (relative to src/) and export name, so a same-named action elsewhere is checked. */
const ALLOWED_WITHOUT_SESSION = new Set(["server/actions/auth.ts:signInAction"]);

interface ActionCheck {
  file: string;
  name: string;
  /** Null when the action calls requireSession() first; otherwise why it does not. */
  problem: string | null;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function hasUseServerDirective(statements: ts.NodeArray<ts.Statement>): boolean {
  for (const statement of statements) {
    // Directives are the leading run of string-literal expression statements.
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === "use server") return true;
  }
  return false;
}

/** `requireSession()`, awaited, as a whole expression: `await requireSession()`. */
function isAwaitedRequireSession(node: ts.Expression | undefined): boolean {
  if (!node || !ts.isAwaitExpression(node)) return false;
  const call = node.expression;
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === "requireSession"
  );
}

/**
 * Only an unconditional, awaited call counts: `await requireSession();`,
 * `const s = await requireSession();`, or a `try` block that starts with one of those.
 * A call inside an `if`, a nested function or without `await` does not.
 */
function startsWithRequireSession(statement: ts.Statement | undefined): boolean {
  if (!statement) return false;
  if (ts.isExpressionStatement(statement)) return isAwaitedRequireSession(statement.expression);
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some((declaration) =>
      isAwaitedRequireSession(declaration.initializer),
    );
  }
  if (ts.isTryStatement(statement))
    return startsWithRequireSession(statement.tryBlock.statements[0]);
  return false;
}

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

function checkBody(fn: FunctionLike): string | null {
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return "has no block body to check";
  const statements = body.statements.filter(
    (s) => !(ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)),
  );
  if (!startsWithRequireSession(statements[0])) {
    return "does not start with `await requireSession()`";
  }
  return null;
}

function isFunctionLike(node: ts.Node | undefined): node is FunctionLike {
  return (
    node !== undefined &&
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))
  );
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function checkFile(file: string): ActionCheck[] {
  const text = readFileSync(file, "utf8");
  if (!text.includes("use server")) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const rel = path.relative(SRC, file);
  const checks: ActionCheck[] = [];
  const add = (name: string, problem: string | null) => checks.push({ file: rel, name, problem });

  if (hasUseServerDirective(source.statements)) {
    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
        add(statement.name?.text ?? "default", checkBody(statement));
      } else if (ts.isVariableStatement(statement) && isExported(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const name = declaration.name.getText(source);
          add(
            name,
            isFunctionLike(declaration.initializer)
              ? checkBody(declaration.initializer)
              : "is not a function the guard can verify",
          );
        }
      } else if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
        // Re-exports / `export default expr` hide the implementation from this check.
        add(statement.getText(source), "is a re-export the guard cannot verify");
      }
    }
  }

  // Inline server actions: any function whose own body starts with "use server".
  const visit = (node: ts.Node) => {
    if (isFunctionLike(node) && node.body && ts.isBlock(node.body)) {
      if (hasUseServerDirective(node.body.statements)) {
        const name =
          (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name
            ? node.name.text
            : `inline action at line ${source.getLineAndCharacterOfPosition(node.pos).line + 1}`;
        add(name, checkBody(node));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return checks;
}

const actions = sourceFiles(SRC).flatMap(checkFile);

describe('every "use server" action calls requireSession() (S-2)', () => {
  it("finds the known server actions (the scan is not vacuous)", () => {
    const names = actions.map((action) => action.name);
    expect(names).toContain("signInAction");
    expect(names).toContain("signOutAction");
  });

  it.each(
    actions.filter((action) => !ALLOWED_WITHOUT_SESSION.has(`${action.file}:${action.name}`)),
  )("$file: $name", ({ problem }) => {
    expect(problem).toBeNull();
  });

  const firstFunction = (code: string) => {
    const fn = ts
      .createSourceFile("x.ts", code, ts.ScriptTarget.Latest, true)
      .statements.find(ts.isFunctionDeclaration);
    return fn ? checkBody(fn) : "not found";
  };

  it.each([
    ["skips it", "export async function leak() { return db.select(); }"],
    ["calls it conditionally", "export async function leak() { if (x) await requireSession(); }"],
    ["does not await it", "export async function leak() { void requireSession(); }"],
    [
      "calls it in a nested function",
      "export async function leak() { const f = () => requireSession(); }",
    ],
    [
      "calls it second",
      "export async function leak() { await db.delete(); await requireSession(); }",
    ],
  ])("flags an action that %s", (_label, code) => {
    expect(firstFunction(`"use server";\n${code}`)).toMatch(/requireSession/);
  });

  it.each([
    "export async function ok() { await requireSession(); }",
    "export async function ok() { const session = await requireSession(); }",
    "export async function ok() { try { await requireSession(); } catch {} }",
  ])("accepts %s", (code) => {
    expect(firstFunction(`"use server";\n${code}`)).toBeNull();
  });
});
