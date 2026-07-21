import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mapPath = resolve(root, '.ai/context-map.json');

function fail(message) {
  console.error(`AI context error: ${message}`);
  process.exit(1);
}

function loadMap() {
  try {
    return JSON.parse(readFileSync(mapPath, 'utf8'));
  } catch (error) {
    fail(`cannot read ${relative(root, mapPath)}: ${error.message}`);
  }
}

function findInstructionFiles(directory = root) {
  const ignored = new Set(['.git', '.next', 'dist', 'node_modules', 'tmp']);
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) found.push(...findInstructionFiles(resolve(directory, entry.name)));
      continue;
    }
    if (entry.isFile() && (entry.name === 'AGENTS.md' || entry.name === 'CLAUDE.md')) {
      found.push(relative(root, resolve(directory, entry.name)).replaceAll('\\', '/'));
    }
  }
  return found;
}

function validateMap(map) {
  const errors = [];
  if (map.version !== 1) errors.push('context map version must be 1');
  if (!map.always || !Array.isArray(map.always.instructions) || !Array.isArray(map.always.contracts)) {
    errors.push('always.instructions and always.contracts must be arrays');
  }
  if (!Array.isArray(map.scopes) || map.scopes.length === 0) {
    errors.push('scopes must be a non-empty array');
  }

  const ids = new Set();
  for (const scope of map.scopes ?? []) {
    if (!scope.id || ids.has(scope.id)) errors.push(`scope id is missing or duplicated: ${scope.id ?? '<missing>'}`);
    ids.add(scope.id);
    for (const key of ['keywords', 'paths', 'instructions', 'contracts', 'reviewWith', 'checks']) {
      if (!Array.isArray(scope[key])) errors.push(`${scope.id}.${key} must be an array`);
    }
    for (const pattern of scope.paths ?? []) {
      try {
        new RegExp(pattern);
      } catch (error) {
        errors.push(`${scope.id} has invalid path pattern ${pattern}: ${error.message}`);
      }
    }
  }

  const referencedFiles = new Set([
    ...(map.always?.instructions ?? []),
    ...(map.always?.contracts ?? []),
    ...(map.scopes ?? []).flatMap((scope) => [...(scope.instructions ?? []), ...(scope.contracts ?? [])]),
  ]);
  for (const file of referencedFiles) {
    if (!existsSync(resolve(root, file))) errors.push(`referenced context file does not exist: ${file}`);
  }

  const mappedInstructions = new Set([
    ...(map.always?.instructions ?? []),
    ...(map.scopes ?? []).flatMap((scope) => scope.instructions ?? []),
  ]);
  for (const file of findInstructionFiles()) {
    if (file.endsWith('AGENTS.md') && !mappedInstructions.has(file)) {
      errors.push(`instruction file is not included in the context map: ${file}`);
    }
    if (file.endsWith('CLAUDE.md') && !readFileSync(resolve(root, file), 'utf8').includes('AGENTS.md')) {
      errors.push(`Claude entrypoint must reference AGENTS.md: ${file}`);
    }
  }

  const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  for (const script of ['ai:context', 'ai:check', 'ai:preflight', 'test:api', 'test:portal', 'verify']) {
    if (!rootPackage.scripts?.[script]) errors.push(`root package.json is missing script: ${script}`);
  }
  const portalPackage = JSON.parse(readFileSync(resolve(root, 'apps/ecoaudit/package.json'), 'utf8'));
  for (const script of ['typecheck', 'test', 'lint', 'build']) {
    if (!portalPackage.scripts?.[script]) errors.push(`portal package.json is missing script: ${script}`);
  }

  for (const scope of map.scopes ?? []) {
    for (const relatedId of scope.reviewWith ?? []) {
      if (!ids.has(relatedId)) errors.push(`${scope.id} references unknown scope ${relatedId}`);
    }
  }

  if (errors.length > 0) fail(errors.join('\n- '));
}

function gitLines(args) {
  try {
    const output = execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch (error) {
    fail(`git ${args.join(' ')} failed: ${error.message}`);
  }
}

function changedFiles() {
  return [...new Set([
    ...gitLines(['diff', '--name-only', 'HEAD']),
    ...gitLines(['ls-files', '--others', '--exclude-standard']),
  ])].sort();
}

function isPathInput(value) {
  return value.includes('/') || /\.[a-z0-9]+$/i.test(value);
}

function scopeMatches(scope, input) {
  const normalized = input.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized === scope.id) return true;
  if (scope.paths.some((pattern) => new RegExp(pattern).test(normalized))) return true;
  if (isPathInput(normalized)) return false;
  const value = normalized.toLowerCase();
  return scope.keywords.some((keyword) => value.includes(keyword.toLowerCase()));
}

function selectScopes(map, inputs) {
  return map.scopes.filter((scope) => inputs.some((input) => scopeMatches(scope, input)));
}

function unique(values) {
  return [...new Set(values)];
}

function printList(title, values) {
  console.log(`\n${title}`);
  if (values.length === 0) {
    console.log('- none');
    return;
  }
  for (const value of values) console.log(`- ${value}`);
}

function printContext(map, inputs, scopes) {
  const selectedIds = new Set(scopes.map((scope) => scope.id));
  console.log('Sustainability Wise task context');
  printList('Inputs', inputs);
  printList('Read first', unique([
    ...map.always.instructions,
    ...map.always.contracts,
    ...scopes.flatMap((scope) => scope.instructions),
    ...scopes.flatMap((scope) => scope.contracts),
  ]));

  console.log('\nMatched scopes');
  if (scopes.length === 0) {
    console.log('- none; pass a scope id or a more specific feature/path');
  } else {
    for (const scope of scopes) console.log(`- ${scope.id}: ${scope.summary}`);
  }

  printList(
    'Review related scopes',
    unique(scopes.flatMap((scope) => scope.reviewWith)).filter((id) => !selectedIds.has(id)),
  );
  printList('Expected quick checks', unique(scopes.flatMap((scope) => scope.checks)));
}

function runPreflight(map) {
  const inputs = changedFiles();
  const scopes = selectScopes(map, inputs);
  printContext(map, inputs.length > 0 ? inputs : ['<clean worktree>'], scopes);

  const commands = unique(scopes.flatMap((scope) => scope.checks));
  if (commands.length === 0) {
    console.log('\nContext structure is valid; no code checks were selected.');
    return;
  }

  for (const command of commands) {
    console.log(`\n> ${command}`);
    const result = spawnSync(command, { cwd: root, shell: true, stdio: 'inherit' });
    if (result.error) fail(`${command} could not start: ${result.error.message}`);
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

const map = loadMap();
validateMap(map);

const args = process.argv.slice(2);
if (args.includes('--check')) {
  console.log(`AI context map is valid (${map.scopes.length} scopes).`);
} else if (args.includes('--preflight')) {
  runPreflight(map);
} else {
  const explicitInputs = args.filter((arg) => !arg.startsWith('--'));
  const inputs = explicitInputs.length > 0 ? explicitInputs : changedFiles();
  const displayInputs = inputs.length > 0 ? inputs : ['<clean worktree>'];
  printContext(map, displayInputs, selectScopes(map, inputs));
  if (inputs.length === 0) {
    printList('Available scope ids', map.scopes.map((scope) => scope.id));
  }
}
