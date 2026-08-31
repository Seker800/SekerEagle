import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve(import.meta.dirname, '..');
const chinese = /[\u3400-\u9fff]/u;

describe('internationalization source boundary', () => {
  it('keeps production Chinese messages behind the translation boundary', async () => {
    const violations: string[] = [];
    for (const file of await productionSources(sourceRoot)) {
      const source = await readFile(file, 'utf8');
      const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node) && chinese.test(node.text)) record(node, node.text);
        if (ts.isTemplateExpression(node)) {
          const literalText =
            node.head.text + node.templateSpans.map((span) => span.literal.text).join('');
          if (chinese.test(literalText)) record(node, literalText);
        }
        if (
          (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
          chinese.test(node.text) &&
          !isTranslationMessage(node) &&
          !isPropertyName(node)
        ) {
          record(node, node.text);
        }
        ts.forEachChild(node, visit);
      };
      const record = (node: ts.Node, message: string) => {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push(
          `${path.relative(sourceRoot, file)}:${position.line + 1} ${message.replace(/\s+/g, ' ').trim()}`,
        );
      };
      visit(sourceFile);
    }
    expect(violations).toEqual([]);
  });
});

async function productionSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (absolute === path.join(sourceRoot, 'i18n', 'messages')) return [];
        return productionSources(absolute);
      }
      return /\.(?:ts|tsx)$/u.test(entry.name) && !/\.test\./u.test(entry.name) ? [absolute] : [];
    }),
  );
  return nested.flat();
}

function isTranslationMessage(node: ts.StringLiteralLike): boolean {
  return (
    (ts.isCallExpression(node.parent) &&
      ts.isIdentifier(node.parent.expression) &&
      ((['t', 'tForLocale'].includes(node.parent.expression.text) &&
        node.parent.arguments[0] === node) ||
        (node.parent.expression.text === 'errorFromResponse' &&
          node.parent.arguments[1] === node))) ||
    isErrorCodeMessage(node)
  );
}

function isErrorCodeMessage(node: ts.StringLiteralLike): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isVariableDeclaration(current)) current = current.parent;
  return !!current && ts.isIdentifier(current.name) && current.name.text === 'ERROR_CODE_MESSAGES';
}

function isPropertyName(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isEnumMember(parent)) &&
    parent.name === node
  );
}
