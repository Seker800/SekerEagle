import { checkRuntimeBoundaries } from './library-runtime-boundaries.mjs';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { join, relative } from 'node:path';

export function readLibrarySources(root) {
  const sources = new Map();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !['dist', 'node_modules'].includes(entry.name)) visit(path);
      else if (/\.(ts|tsx|css|mjs|cjs)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        sources.set(relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8'));
      }
    }
  }
  const directories = [
    'apps/web/src',
    'apps/api/src',
    'apps/worker/src',
    ...readdirSync(join(root, 'packages')).map((name) => `packages/${name}/src`),
  ];
  for (const directory of directories)
    if (existsSync(join(root, directory))) visit(join(root, directory));
  sources.set(
    'apps/api/prisma/schema.prisma',
    readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8'),
  );
  return sources;
}

const page = 'apps/web/src/components/eagle/SekerEaglePage.tsx';
const photoModule = 'apps/api/src/photos/photo-library.module.ts';
const neutralCore = [
  'eagle-masonry-layout.ts',
  'EagleAssetThumbnail.tsx',
  'EagleImageViewer.tsx',
  'EagleAssetLightbox.tsx',
  'EagleLivePhotoPlayback.tsx',
  'EagleLocateAssetButton.tsx',
  'useEagleAssetLocation.ts',
  'eagle-quick-filter-state.ts',
].map((name) => `apps/web/src/components/eagle/${name}`);
const composition = {
  [page]: {
    useEagleMasonryLayout: './eagle-masonry-layout',
    useEagleAssetViewport: './eagle-asset-viewport',
    useEagleUploadController: './useEagleUploadController',
    useEagleMutations: './useEagleMutations',
    EagleAssetThumbnail: './EagleAssetThumbnail',
    EagleQuickFilterBar: './EagleQuickFilterBar',
    EagleImageViewer: './EagleImageViewer',
  },
  'apps/web/src/App.tsx': { SekerEaglePage: './components/eagle/SekerEaglePage' },
};
const controllers = {
  PhotosController: 'EagleController',
  PhotoUploadsController: 'EagleUploadController',
  PhotoVectorsController: 'EagleVectorController',
  PhotoProcessingController: 'EagleProcessingController',
  PhotoTaskCenterController: 'EagleTaskCenterController',
};
function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}
// Accept only the named React import lazy(() => import(required).then(module => ({default: module.Required}))).
// Merely mentioning the module inside an unrelated loader must not satisfy composition.
function isLazyComposition(node, tree, module, name) {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return false;
  const init = node.initializer;
  if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression)) return false;
  let reactLazy = false;
  walk(tree, (child) => {
    if (!ts.isImportDeclaration(child) || child.moduleSpecifier.text !== 'react') return;
    const bindings = child.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      reactLazy ||= bindings.elements.some(
        (spec) =>
          (spec.propertyName ?? spec.name).text === 'lazy' &&
          spec.name.text === init.expression.text,
      );
  });
  const loader = init.arguments[0];
  if (!reactLazy || !loader || !ts.isArrowFunction(loader)) return false;
  const then = loader.body;
  if (
    !ts.isCallExpression(then) ||
    !ts.isPropertyAccessExpression(then.expression) ||
    then.expression.name.text !== 'then'
  )
    return false;
  const imported = then.expression.expression;
  if (
    !ts.isCallExpression(imported) ||
    imported.expression.kind !== ts.SyntaxKind.ImportKeyword ||
    imported.arguments[0]?.text !== module
  )
    return false;
  const mapping = then.arguments[0];
  if (!mapping || !ts.isArrowFunction(mapping) || mapping.parameters.length !== 1) return false;
  const parameter = mapping.parameters[0].name;
  if (!ts.isIdentifier(parameter)) return false;
  const body = ts.isParenthesizedExpression(mapping.body) ? mapping.body.expression : mapping.body;
  if (!ts.isObjectLiteralExpression(body) || body.properties.length !== 1) return false;
  const property = body.properties[0];
  return (
    ts.isPropertyAssignment(property) &&
    property.name.getText(tree) === 'default' &&
    ts.isPropertyAccessExpression(property.initializer) &&
    property.initializer.expression.getText(tree) === parameter.text &&
    property.initializer.name.text === name
  );
}
function hasMode(node, aliases = new Set()) {
  let found = false;
  walk(node, (child) => {
    if (
      (ts.isIdentifier(child) && (child.text === 'libraryMode' || aliases.has(child.text))) ||
      (ts.isStringLiteral(child) && ['PHOTO', 'MATERIAL'].includes(child.text))
    )
      found = true;
  });
  return found;
}
function isPresentationLabel(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxAttribute(parent)) return ['aria-label', 'title'].includes(parent.name.text);
    if (ts.isStatement(parent)) break;
  }
  return false;
}
const modeAliases = new WeakMap();
function aliasesFor(node) {
  const tree = node.getSourceFile();
  if (modeAliases.has(tree)) return modeAliases.get(tree);
  const aliases = new Set(['libraryMode']);
  const declarations = [];
  walk(tree, (child) => {
    if (
      ts.isVariableDeclaration(child) &&
      ts.isIdentifier(child.name) &&
      child.initializer &&
      ts.isVariableDeclarationList(child.parent) &&
      child.parent.flags & ts.NodeFlags.Const
    )
      declarations.push(child);
  });
  const pureMode = (expression) => {
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression))
      return pureMode(expression.expression);
    if (ts.isIdentifier(expression)) return aliases.has(expression.text);
    if (ts.isStringLiteral(expression)) return ['PHOTO', 'MATERIAL'].includes(expression.text);
    if (ts.isPrefixUnaryExpression(expression))
      return expression.operator === ts.SyntaxKind.ExclamationToken && pureMode(expression.operand);
    if (ts.isBinaryExpression(expression))
      return (
        [
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
        ].includes(expression.operatorToken.kind) &&
        pureMode(expression.left) &&
        pureMode(expression.right)
      );
    return false;
  };
  let changed;
  do {
    changed = false;
    for (const declaration of declarations) {
      if (!aliases.has(declaration.name.text) && pureMode(declaration.initializer)) {
        aliases.add(declaration.name.text);
        changed = true;
      }
    }
  } while (changed);
  modeAliases.set(tree, aliases);
  return aliases;
}
function modeGuarded(node) {
  const aliases = aliasesFor(node);
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      (ts.isIfStatement(parent) || ts.isConditionalExpression(parent)) &&
      hasMode(parent.expression ?? parent.condition, aliases)
    )
      return true;
    if (
      ts.isBinaryExpression(parent) &&
      [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(
        parent.operatorToken.kind,
      ) &&
      hasMode(parent.left, aliases)
    )
      return true;
    if (ts.isSwitchStatement(parent) && hasMode(parent.expression, aliases)) return true;
  }
  return false;
}

// Only the registered persistence paths use this work-target protocol. Decoder
// slots, S3 parts and unrelated product pagination retain their own contracts.
const databaseBatchPaths = new Set(
  [
    'eagle-asset-operations.service.ts',
    'eagle-duplicates.service.ts',
    'eagle-duplicate-cleanup.ts',
    'eagle-duplicate-index.ts',
    'eagle-duplicate-verification.ts',
  ].map((name) => `apps/api/src/eagle/${name}`),
);
function checkDatabaseBatchBudget(file, tree, report) {
  if (!databaseBatchPaths.has(file)) return;
  const rawTargets = new Set();
  const literalTarget = (node) =>
    ts.isNumericLiteral(node) && [500, 512].includes(Number(node.text));
  walk(tree, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      literalTarget(node.initializer)
    )
      rawTargets.add(node.name.text);
  });
  const containsRawTarget = (node) => {
    let found = false;
    walk(node, (child) => {
      found ||= literalTarget(child) || (ts.isIdentifier(child) && rawTargets.has(child.text));
    });
    return found;
  };
  walk(tree, (node) => {
    const rawIncrement =
      ts.isForStatement(node) && node.incrementor && containsRawTarget(node.incrementor);
    const rawSlice =
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'slice' &&
      node.arguments.some(containsRawTarget);
    if (rawIncrement || rawSlice)
      report(
        file,
        'database-batch-budget',
        'Use a registered database statement budget for persistence batches.',
      );
  });
}

const backgroundApiClasses = new Map([
  ['apps/api/src/eagle/eagle-maintenance.service.ts', 'EagleMaintenanceService'],
  ['apps/api/src/eagle/eagle-upload-recovery.service.ts', 'EagleUploadRecoveryService'],
]);
function importedIdentity(tree, local, canonical, module) {
  return tree.statements.some(
    (node) =>
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier.text === module &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some(
        (binding) =>
          binding.name.text === local && (binding.propertyName ?? binding.name).text === canonical,
      ),
  );
}
function checkOperationsBackground(file, tree, report) {
  const reject = () =>
    report(
      file,
      'operations-background-host',
      'Maintenance and upload recovery run only in the explicitly assembled operations host.',
    );
  const apiClass = backgroundApiClasses.get(file);
  if (apiClass)
    walk(tree, (node) => {
      if (!ts.isClassDeclaration(node) || node.name?.text !== apiClass) return;
      for (const member of node.members) {
        const lifecycle =
          ts.isMethodDeclaration(member) &&
          ['onModuleInit', 'onApplicationBootstrap'].includes(member.name.getText(tree));
        if (lifecycle) reject();
        if (ts.isConstructorDeclaration(member) && member.body)
          walk(member.body, (child) => {
            if (!ts.isCallExpression(child)) return;
            const callee = child.expression;
            const callsWork =
              ts.isPropertyAccessExpression(callee) &&
              callee.expression.kind === ts.SyntaxKind.ThisKeyword;
            const startsTimer =
              ts.isIdentifier(callee) &&
              (['setInterval', 'setTimeout'].includes(callee.text) ||
                ['setInterval', 'setTimeout'].some((name) =>
                  importedIdentity(tree, callee.text, name, 'node:timers'),
                ));
            if (callsWork || startsTimer) reject();
          });
      }
    });
  if (file !== 'apps/api/src/asset-operation-executor.ts') return;
  const factory = tree.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'createAssetOperationBackground',
  );
  const required = [
    ['EagleUploadRecoveryService', './eagle/eagle-upload-recovery.service'],
    ['EagleMaintenanceService', './eagle/eagle-maintenance.service'],
    ['AssetOperationBackground', './asset-operation-background'],
  ];
  const constructed = new Set();
  let bothModes = false;
  if (factory)
    walk(factory, (node) => {
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression))
        for (const [name, module] of required)
          if (importedIdentity(tree, node.expression.text, name, module)) constructed.add(name);
      if (ts.isArrayLiteralExpression(node))
        bothModes ||=
          node.elements.length === 2 &&
          node.elements.every(ts.isStringLiteral) &&
          new Set(node.elements.map((item) => item.text)).size === 2 &&
          node.elements.some((item) => item.text === 'MATERIAL') &&
          node.elements.some((item) => item.text === 'PHOTO');
    });
  const hosts = new Set();
  walk(tree, (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      ts.isCallExpression(node.right) &&
      ts.isIdentifier(node.right.expression) &&
      node.right.expression.text === factory?.name?.text
    )
      hosts.add(node.left.text);
  });
  let started = false;
  walk(tree, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      hosts.has(node.expression.expression.text) &&
      node.expression.name.text === 'start'
    )
      started = true;
  });
  if (constructed.size !== required.length || !bothModes || !started) reject();
}

/** Structural contracts, not a claim to prove arbitrary program equivalence. */
export function checkLibrarySharing(sources) {
  const errors = [];
  const report = (file, rule, message) => errors.push({ file, rule, message });
  // Browser adapters cannot grow a second pixel/crop/watermark implementation.
  for (const name of [
    'photo-editor-photon',
    'photo-editor-tone',
    'photo-editor-detail',
    'photo-editor-watermark',
    'photo-editor-model',
    'photo-editor-color-mixer',
    'photo-editor-denoise',
    'photo-editor-dehaze',
  ]) {
    const file = `apps/web/src/components/media/photo-editor/${name}.ts`;
    const source = sources.get(file) ?? '';
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    if (
      tree.statements.length !== 1 ||
      !ts.isExportDeclaration(tree.statements[0]) ||
      tree.statements[0].moduleSpecifier?.text !== `@sekereagle/photo-render-core/${name}`
    )
      report(
        file,
        'shared-photo-render',
        'Browser and server must use the canonical photo-render-core implementation.',
      );
  }
  const trees = new Map();
  for (const file of [
    ...Object.keys(composition),
    ...neutralCore,
    photoModule,
    'apps/api/src/eagle/eagle.module.ts',
  ]) {
    if (!sources.has(file))
      report(
        file,
        'required-source',
        'Required shared entry is missing; review architecture before moving it.',
      );
  }
  for (const [file, source] of sources) {
    if (!/\.tsx?$/.test(file)) continue;
    const tree = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    trees.set(file, tree);
    checkDatabaseBatchBudget(file, tree, report);
    checkOperationsBackground(file, tree, report);
    for (const error of tree.parseDiagnostics) {
      report(file, 'parse-error', ts.flattenDiagnosticMessageText(error.messageText, ' '));
    }
    if (file.startsWith('apps/web/src/') || file.startsWith('packages/library-core/src/')) {
      walk(tree, (node) => {
        const dependency =
          ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
            ? node.moduleSpecifier
            : ts.isCallExpression(node) &&
                (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                  node.expression.getText(tree) === 'require')
              ? node.arguments[0]
              : undefined;
        if (
          dependency &&
          ts.isStringLiteral(dependency) &&
          /(?:library-persistence|@prisma\/client)/.test(dependency.text)
        )
          report(
            file,
            'server-persistence-boundary',
            'Browser and pure library-core must not depend on database persistence.',
          );
      });
    }
    const isShared =
      file.startsWith('apps/web/src/components/eagle/') || file.startsWith('apps/api/src/eagle/');
    if (isShared && file !== page)
      walk(tree, (node) => {
        const dependency =
          ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
            ? node.moduleSpecifier
            : ts.isCallExpression(node) &&
                (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                  node.expression.getText(tree) === 'require')
              ? node.arguments[0]
              : undefined;
        if (
          dependency &&
          ts.isStringLiteral(dependency) &&
          /(?:^|\/)photos(?:\/|$)|photo-management-api/.test(dependency.text)
        ) {
          report(
            file,
            'dependency-direction',
            'Shared core cannot depend on photography extensions; compose them at the workspace boundary.',
          );
        }
      });
    if (neutralCore.includes(file))
      walk(tree, (node) => {
        if (
          ts.isStringLiteral(node) &&
          ['PHOTO', 'MATERIAL'].includes(node.text) &&
          !ts.isLiteralTypeNode(node.parent) &&
          !isPresentationLabel(node)
        ) {
          report(
            file,
            'mode-neutral-core',
            'Shared layout, renderer, viewer and filter state must stay mode-neutral.',
          );
        }
      });
  }
  for (const [file, required] of Object.entries(composition)) {
    const tree = trees.get(file);
    if (!tree) continue;
    for (const [name, module] of Object.entries(required)) {
      const locals = [];
      walk(tree, (node) => {
        if (isLazyComposition(node, tree, module, name)) locals.push(node.name.text);
        if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === module) {
          const bindings = node.importClause?.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const spec of bindings.elements) {
              if ((spec.propertyName ?? spec.name).text === name) locals.push(spec.name.text);
            }
          }
        }
      });
      const uses = [];
      walk(tree, (node) => {
        if (
          (ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            locals.includes(node.expression.text)) ||
          ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
            locals.includes(node.tagName.getText(tree)))
        )
          uses.push(node);
      });
      if (uses.length !== 1 || modeGuarded(uses[0])) {
        report(
          file,
          'shared-composition',
          `${name} must have one shared, mode-independent composition point from ${module}.`,
        );
      }
    }
  }
  const pageTree = trees.get(page);
  if (pageTree) {
    let cards = 0;
    walk(pageTree, (node) => {
      if (!ts.isJsxElement(node)) return;
      let isCard = false;
      walk(node.openingElement.attributes, (child) => {
        if (
          ts.isPropertyAccessExpression(child) &&
          child.expression.getText(pageTree) === 'styles' &&
          child.name.text === 'assetCard'
        )
          isCard = true;
      });
      if (!isCard) return;
      cards++;
      let fork = false;
      walk(node, (child) => {
        if (
          ((ts.isIdentifier(child) && child.text === 'libraryMode') ||
            (ts.isStringLiteral(child) && ['PHOTO', 'MATERIAL'].includes(child.text))) &&
          !isPresentationLabel(child)
        )
          fork = true;
      });
      if (fork)
        report(
          page,
          'shared-card',
          'Generic cards cannot branch by library mode; only accessible wording may differ.',
        );
    });
    if (cards !== 1)
      report(page, 'shared-card', 'Keep one shared card composition for both libraries.');
  }
  for (const [file, tree] of trees) {
    if (!file.startsWith('apps/api/src/photos/') || file === photoModule) continue;
    walk(tree, (node) => {
      if (!ts.isClassDeclaration(node)) return;
      const parent = node.heritageClauses?.find(
        (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
      );
      if (
        parent?.types.some((type) =>
          Object.values(controllers).includes(type.expression.getText(tree)),
        )
      )
        report(
          file,
          'inherited-controllers',
          'Shared controller subclasses must stay in the reviewed photo module.',
        );
    });
  }
  const photoTree = trees.get(photoModule);
  if (photoTree) {
    const classes = new Map();
    walk(photoTree, (node) => {
      if (ts.isClassDeclaration(node) && node.name) classes.set(node.name.text, node);
    });
    for (const [name, base] of Object.entries(controllers)) {
      const node = classes.get(name);
      const parent = node?.heritageClauses?.find(
        (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
      );
      if (
        !node ||
        node.members.length ||
        parent?.types[0]?.expression.getText(photoTree) !== base
      ) {
        report(
          photoModule,
          'inherited-controllers',
          `${name} must inherit ${base} without overriding any shared method or constructor.`,
        );
      }
    }
    // Only photography providers and immutable scope bindings may supplement the common list.
    const allowed = new Set([
      'PhotoManagementService',
      'PhotoPersonReviewService',
      'PhotoMapService',
      'PhotoStatisticsService',
      'PhotoRevisionObserver',
      'PhotoAgentService',
    ]);
    let spreads = 0;
    walk(photoTree, (node) => {
      if (
        !ts.isPropertyAssignment(node) ||
        node.name.getText(photoTree) !== 'providers' ||
        !ts.isArrayLiteralExpression(node.initializer)
      )
        return;
      for (const provider of node.initializer.elements) {
        if (ts.isSpreadElement(provider)) {
          if (
            provider.expression.getText(photoTree).replace(/\s/g, '') ===
            "libraryProviders('PHOTO')"
          )
            spreads++;
          else
            report(
              photoModule,
              'shared-providers',
              'Use the shared provider registry; only the host maintenance scheduler is excluded.',
            );
        } else if (ts.isIdentifier(provider) && allowed.has(provider.text)) {
          // Explicit photography extension.
        } else if (ts.isObjectLiteralExpression(provider)) {
          const fields = new Map(
            provider.properties
              .filter(ts.isPropertyAssignment)
              .map((field) => [
                field.name.getText(photoTree),
                field.initializer.getText(photoTree),
              ]),
          );
          const scope =
            fields.size === 2 &&
            fields.get('provide') === 'LIBRARY_MODE' &&
            ["'PHOTO'", '"PHOTO"'].includes(fields.get('useValue'));
          const observer =
            fields.size === 2 &&
            fields.get('provide') === 'LIBRARY_REVISION_OBSERVER' &&
            fields.get('useExisting') === 'PhotoRevisionObserver';
          if (!scope && !observer)
            report(
              photoModule,
              'shared-providers',
              'Do not replace generic services in the photo module.',
            );
        } else
          report(
            photoModule,
            'shared-providers',
            'New providers need an explicit photography boundary review.',
          );
      }
    });
    if (spreads !== 1)
      report(
        photoModule,
        'shared-providers',
        'Photo module must consume the common provider registry exactly once.',
      );
  }
  return [...errors, ...checkRuntimeBoundaries(sources, trees)];
}
