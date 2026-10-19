import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

function hasLibraryScope(receiver: string, predicate: string) {
  return (
    /libraryMode|inLibrary\(/.test(predicate) ||
    (receiver.endsWith('.eagleLibraryTransfer') &&
      /sourceMode/.test(predicate) &&
      /ownerId/.test(predicate))
  );
}
test('transfer operation scope never exempts ordinary asset queries or omits the owner', () => {
  assert.equal(hasLibraryScope('tx.eagleLibraryTransfer', '{ ownerId, sourceMode }'), true);
  assert.equal(hasLibraryScope('tx.eagleLibraryTransfer', '{ sourceMode }'), false);
  assert.equal(hasLibraryScope('tx.eagleAsset', '{ ownerId, sourceMode }'), false);
});

// A security tripwire for fluent/newline Prisma calls as well as ordinary calls.
// Runtime database tests remain authoritative about owner and mode behavior.
test('library service ORM predicates always declare a library scope', () => {
  const violations: string[] = [];
  for (const file of readdirSync(__dirname).filter(
    (name) => name.endsWith('.service.ts') && !name.includes('maintenance'),
  )) {
    const source = readFileSync(join(__dirname, file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        /^(find|count|aggregate|groupBy|update|delete|upsert)/.test(node.expression.name.text)
      ) {
        const receiver = node.expression.expression.getText(ast).replace(/\s/g, '');
        if (
          /\.(eagle\w+|uploadSession)$/.test(receiver) &&
          !/(eagleProcessingWorkerHeartbeat|eagleEmbeddingSpace)$/.test(receiver)
        ) {
          const args = node.arguments[0];
          if (args && ts.isObjectLiteralExpression(args)) {
            const where = args.properties.find(
              (property) => property.name?.getText(ast) === 'where',
            );
            if (where && !hasLibraryScope(receiver, where.getText(ast)))
              violations.push(
                `${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}`,
              );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  assert.deepEqual(
    violations,
    [],
    'Unscoped predicates require a fixed library or an explicit global-infrastructure exemption.',
  );
});
