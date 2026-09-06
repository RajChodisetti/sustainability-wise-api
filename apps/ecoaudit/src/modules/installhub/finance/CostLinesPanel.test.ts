import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import type { CostLine } from './types';

type Node = { type: unknown; props: Record<string, unknown> };
type PanelProps = { installationId: string; lines: CostLine[]; currency: string; canEdit: boolean };

function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const element = value as Node;
  return [element, ...nodes(element.props.children)];
}

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(' ');
  if (value == null || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return text((value as Node).props?.children);
}

function renderHarness(props: Partial<PanelProps> = {}, createError?: string) {
  const state: unknown[] = [];
  let cursor = 0;
  const creates: Record<string, unknown>[] = [];
  const updates: unknown[] = [];
  const deletes: string[] = [];
  const hookScopes: string[] = [];
  const create = { isPending: false, mutateAsync: async (value: Record<string, unknown>) => {
    creates.push(value);
    if (createError) throw new Error(createError);
  } };
  const update = { mutateAsync: async (value: unknown) => { updates.push(value); } };
  const remove = { mutateAsync: async (value: string) => { deletes.push(value); } };
  const loaded = { exports: {} as { CostLinesPanel: (props: PanelProps) => Node } };
  const imports: Record<string, unknown> = {
    'react': { useState(initial: unknown) {
      const index = cursor++;
      if (index >= state.length) state[index] = initial;
      return [state[index], (next: unknown) => { state[index] = next; }];
    } },
    'react/jsx-runtime': {
      jsx: (type: unknown, attrs: Record<string, unknown>) => ({ type, props: attrs }),
      jsxs: (type: unknown, attrs: Record<string, unknown>) => ({ type, props: attrs }),
    },
    '@/components/ui/Button': { Button: 'Button' },
    '@/components/ui/FormFields': { FieldLabel: 'FieldLabel', Input: 'Input', Select: 'Select' },
    '@/modules/installhub/api/client': { installHubConnectionErrorMessage: (error: Error) => error.message },
    '@/modules/installhub/finance/hooks': {
      useCreateCostLine: (id: string) => { hookScopes.push(id); return create; },
      useUpdateCostLine: (id: string) => { hookScopes.push(id); return update; },
      useDeleteCostLine: (id: string) => { hookScopes.push(id); return remove; },
    },
  };
  const source = readFileSync(new URL('./CostLinesPanel.tsx', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports: loaded.exports, require: (name: string) => {
    assert.ok(name in imports, `Uncontrolled dependency: ${name}`);
    return imports[name];
  } });
  const input: PanelProps = { installationId: 'synthetic-installation', lines: [], currency: 'AUD', canEdit: true, ...props };
  const render = () => { cursor = 0; return loaded.exports.CostLinesPanel(input); };
  return { render, creates, updates, deletes, hookScopes, input };
}

function field(tree: Node, label: string): Node | undefined {
  const parent = nodes(tree).find((node) => {
    const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
    return children.some((child) => (child as Node | null)?.type === 'FieldLabel' && text(child) === label);
  });
  return parent ? nodes(parent.props.children).find((node) => node.type === 'Input' || node.type === 'Select') : undefined;
}

function enter(tree: Node, label: string, value: string) {
  const input = field(tree, label);
  assert.ok(input, `Missing editable ${label}`);
  (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
}

const line: CostLine = {
  id: 'synthetic-cost', installationId: 'synthetic-installation', category: 'labour',
  description: 'Preserved labour cost', costAmount: 12.5, sellAmount: 18.75,
  hours: 4.25, billable: true, invoiced: true, source: 'manual', incurredAt: null,
  createdByUserId: null, createdAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z',
};

test('the real cost form exposes no ledger-owned hour editor', () => {
  const { render, updates } = renderHarness({ lines: [line] });
  const tree = render();
  assert.equal(field(tree, 'Hours'), undefined, 'Cost-line hours cannot be authored through this endpoint.');
  assert.match(text(tree), /4\.25/);
  assert.match(text(tree), /Invoiced/);
  assert.deepEqual(updates, []);
});

test('invoice flags are read-only for both unbilled and invoiced server rows', () => {
  for (const invoiced of [true, false]) {
    const tree = renderHarness({ lines: [{ ...line, invoiced }] }).render();
    const actions = nodes(tree).filter((node) => typeof node.props.onClick === 'function');
    assert.equal(actions.some((node) => /invoiced/i.test(text(node))), false, 'Invoice state is controlled by invoice lifecycle.');
    assert.match(text(tree), invoiced ? /Invoiced/ : /Uninvoiced/);
  }
});

test('the real add handler submits editable costs without rejected ledger properties', async () => {
  const fixture = renderHarness();
  let tree = fixture.render();
  enter(tree, 'Category', 'material');
  enter(tree, 'Description', '  Synthetic cable  ');
  enter(tree, 'Cost', '12.50');
  enter(tree, 'Sell', '18.75');
  tree = fixture.render();
  const form = nodes(tree).find((node) => node.type === 'form');
  assert.ok(form);
  (form.props.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault() {} });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fixture.creates.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.creates[0])), {
    category: 'material', description: 'Synthetic cable', costAmount: 12.5, sellAmount: 18.75, billable: true,
  });
  assert.equal(Object.hasOwn(fixture.creates[0], 'hours'), false);
  assert.equal(Object.hasOwn(fixture.creates[0], 'invoiced'), false);
  assert.ok(fixture.hookScopes.every((id) => id === 'synthetic-installation'));
  tree = fixture.render();
  assert.equal(field(tree, 'Description')?.props.value, '');
  assert.equal(field(tree, 'Cost')?.props.value, '');
  assert.equal(field(tree, 'Sell')?.props.value, '');
});

test('valid manual deletion remains scoped while system lines and read-only views stay protected', async () => {
  const original = JSON.stringify(line);
  const fixture = renderHarness({ lines: [line, { ...line, id: 'synthetic-auto', source: 'auto_labour' }] });
  const deletions = nodes(fixture.render()).filter((node) => node.type === 'button' && text(node) === 'Delete');
  assert.equal(deletions.length, 1);
  (deletions[0].props.onClick as () => void)();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(fixture.deletes, ['synthetic-cost']);
  assert.equal(JSON.stringify(line), original);
  const readOnly = renderHarness({ lines: [line], canEdit: false }).render();
  assert.equal(nodes(readOnly).some((node) => node.type === 'form'), false);
  assert.equal(nodes(readOnly).some((node) => typeof node.props.onClick === 'function'), false);
  assert.match(text(readOnly), /4\.25/);
});

test('create failure preserves the entered cost and displays the server error', async () => {
  const fixture = renderHarness({}, 'Synthetic cost rejected');
  let tree = fixture.render();
  enter(tree, 'Description', 'Keep this draft');
  enter(tree, 'Cost', '2.50');
  tree = fixture.render();
  const form = nodes(tree).find((node) => node.type === 'form');
  assert.ok(form);
  (form.props.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault() {} });
  await new Promise<void>((resolve) => setImmediate(resolve));
  tree = fixture.render();
  assert.match(text(tree), /Synthetic cost rejected/);
  assert.equal(field(tree, 'Description')?.props.value, 'Keep this draft');
  assert.equal(field(tree, 'Cost')?.props.value, '2.50');
  assert.equal(fixture.creates[0].sellAmount, null);
});
