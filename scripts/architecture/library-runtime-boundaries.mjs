import { builtinModules } from 'node:module';
import { posix } from 'node:path';
import ts from 'typescript';

const registry = 'apps/api/src/eagle/library-capabilities.ts';
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}
function decorators(node) {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}
function unwrap(node) {
  while (
    node &&
    (ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isParenthesizedExpression(node))
  )
    node = node.expression;
  return node;
}
function fields(node, tree) {
  return new Map(
    node.properties
      .filter(ts.isPropertyAssignment)
      .map((property) => [property.name.getText(tree), unwrap(property.initializer)]),
  );
}
function strings(node) {
  return node && ts.isArrayLiteralExpression(node)
    ? node.elements.filter(ts.isStringLiteral).map((item) => item.text)
    : [];
}
function dependency(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier;
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
    return node.argument.literal;
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      node.expression.getText() === 'require')
  )
    return node.arguments[0];
}

/** Checks dependency and ownership facts, independently of component/file sizes. */
export function checkRuntimeBoundaries(sources, parsedTrees = new Map()) {
  const errors = [];
  const report = (file, rule, message) => errors.push({ file, rule, message });
  const owners = new Map(),
    tableOwners = new Map(),
    capabilities = new Map();
  const text = sources.get(registry);
  if (!text)
    report(registry, 'capability-ownership', 'The shared provider ownership registry is required.');
  if (text) {
    const tree =
      parsedTrees.get(registry) ??
      ts.createSourceFile(registry, text, ts.ScriptTarget.Latest, true);
    walk(tree, (node) => {
      if (
        !ts.isVariableDeclaration(node) ||
        node.name.getText(tree) !== 'EAGLE_LIBRARY_CAPABILITIES'
      )
        return;
      const array = unwrap(node.initializer);
      if (!array || !ts.isArrayLiteralExpression(array)) {
        report(registry, 'capability-ownership', 'Capabilities must be explicit records.');
        return;
      }
      for (const entry of array.elements) {
        if (!ts.isObjectLiteralExpression(entry)) {
          report(registry, 'capability-ownership', 'Register capabilities explicitly.');
          continue;
        }
        const values = fields(entry, tree),
          id = values.get('id')?.text;
        const modes = strings(values.get('modes'));
        if (
          !id ||
          capabilities.has(id) ||
          !modes.length ||
          modes.some((mode) => !['MATERIAL', 'PHOTO'].includes(mode))
        )
          report(
            registry,
            'capability-ownership',
            'Capability identity and eligible modes must be unique and explicit.',
          );
        capabilities.set(id, strings(values.get('dependsOn')));
        const providers = values.get('providers');
        if (!providers || !ts.isArrayLiteralExpression(providers) || !providers.elements.length)
          report(registry, 'capability-ownership', 'A capability must own its providers.');
        else
          for (const provider of providers.elements) {
            const token = ts.isIdentifier(provider)
              ? provider.text
              : ts.isObjectLiteralExpression(provider)
                ? fields(provider, tree).get('provide')?.getText(tree)
                : undefined;
            if (!token || owners.has(token))
              report(
                registry,
                'capability-ownership',
                `Provider ${token ?? '?'} needs exactly one capability owner.`,
              );
            owners.set(token, id);
          }
        for (const table of strings(values.get('tables'))) {
          if (tableOwners.has(table))
            report(
              registry,
              'capability-ownership',
              `Persisted model ${table} has more than one owner.`,
            );
          tableOwners.set(table, id);
        }
      }
    });
    const schema = sources.get('apps/api/prisma/schema.prisma');
    if (schema)
      for (const table of tableOwners.keys())
        if (!new RegExp(`\\bmodel\\s+${table}\\s*\\{`, 'u').test(schema))
          report(registry, 'capability-ownership', `Unknown persisted model ${table}.`);
    for (const [id, dependencies] of capabilities) {
      if (dependencies.some((dep) => dep === id || !capabilities.has(dep)))
        report(
          registry,
          'capability-ownership',
          `Capability ${id} has an unknown or self dependency.`,
        );
      const visited = new Set();
      const cyclic = (current) => {
        if (current === id) return true;
        if (visited.has(current)) return false;
        visited.add(current);
        return (capabilities.get(current) ?? []).some(cyclic);
      };
      if (dependencies.some(cyclic))
        report(registry, 'capability-ownership', `Capability ${id} has a dependency cycle.`);
    }
  }
  for (const [file, source] of sources) {
    if (!/\.(?:[cm]?js|tsx?)$/u.test(file)) continue;
    const tree =
      parsedTrees.get(file) ??
      ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
    const nestNames = new Map();
    for (const item of tree.statements)
      if (
        ts.isImportDeclaration(item) &&
        item.moduleSpecifier.text === '@nestjs/common' &&
        item.importClause?.namedBindings &&
        ts.isNamedImports(item.importClause.namedBindings)
      )
        for (const spec of item.importClause.namedBindings.elements)
          nestNames.set(spec.name.text, (spec.propertyName ?? spec.name).text);
    const decoratorName = (item) =>
      ts.isCallExpression(item.expression)
        ? (nestNames.get(item.expression.expression.getText(tree)) ??
          item.expression.expression.getText(tree))
        : '';
    walk(tree, (node) => {
      if (
        file.startsWith('apps/api/src/eagle/') &&
        ts.isClassDeclaration(node) &&
        node.name &&
        decorators(node).some((item) => decoratorName(item) === 'Injectable') &&
        !owners.has(node.name.text)
      )
        report(
          file,
          'capability-ownership',
          `${node.name.text} is not registered to a capability.`,
        );
      if (file.startsWith('apps/api/src/') && ts.isConstructorDeclaration(node))
        for (const parameter of node.parameters) {
          const ds = decorators(parameter),
            injected = ds.some(
              (item) =>
                decoratorName(item) === 'Inject' &&
                item.expression.arguments[0]?.getText(tree) === 'LIBRARY_MODE',
            );
          if (
            injected &&
            (parameter.initializer ||
              parameter.questionToken ||
              ds.some((item) => decoratorName(item) === 'Optional'))
          )
            report(
              file,
              'mode-assembly',
              'Mode injection must be required; no optional/default MATERIAL fallback.',
            );
        }
      const specifier = dependency(node);
      if (!specifier || !ts.isStringLiteral(specifier)) return;
      const spec = specifier.text,
        target = spec.startsWith('.')
          ? posix.normalize(posix.join(posix.dirname(file), spec))
          : spec;
      const pure =
        file.startsWith('packages/library-core/src/') ||
        (file.startsWith('packages/photo-render-core/src/') && !file.endsWith('/server-render.ts'));
      const browser = file.startsWith('apps/web/src/');
      const serverImport =
        /(?:^@sekereagle\/(?:library-persistence|media-core|api|worker)(?:\/|$)|^@prisma\/|^@aws-sdk\/|^@sekereagle\/photo-render-core\/server(?:\/|$)|^(?:apps\/(?:api|worker)\/|packages\/(?:library-persistence|media-core)\/)|^packages\/photo-render-core\/src\/server-render(?:\.|$))/u.test(
          target,
        );
      const forbiddenIo =
        builtins.has(spec) ||
        spec.startsWith('node:') ||
        ['sharp', '@napi-rs/canvas'].includes(spec);
      const packageToApp =
        file.startsWith('packages/') &&
        /^(?:apps\/|@sekereagle\/(?:api|worker|web)(?:\/|$))/u.test(target);
      const applicationCrossing =
        (file.startsWith('apps/worker/src/') &&
          /^(?:apps\/api\/|@sekereagle\/api(?:\/|$))/u.test(target)) ||
        (file.startsWith('apps/api/src/') &&
          /^(?:apps\/worker\/|@sekereagle\/worker(?:\/|$))/u.test(target));
      if (
        ((pure || browser) && (serverImport || forbiddenIo)) ||
        packageToApp ||
        applicationCrossing
      )
        report(
          file,
          'runtime-boundary',
          `Dependency ${spec} crosses its runtime or ownership boundary.`,
        );
    });
  }
  return errors;
}
