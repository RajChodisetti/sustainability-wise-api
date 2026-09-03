import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TopologyTreeDiagram } from '@/modules/fleet/components/TopologyTreeDiagram';
import type { TopologyTreeItem } from '@/modules/fleet/lib/topologyBeta';

test('topology diagram shows parent, child and sibling structure without raw telemetry status', () => {
  const reviewedEdge = {
    parent: 'grid',
    child: 'load-a',
    state: 'REVIEW' as const,
    confidenceLabel: 'Reviewed site relation',
    provenance: 'REVIEWED_SITE_EVIDENCE',
  };
  const child = (meterId: string, deviceId: string): TopologyTreeItem => ({
    node: {
      meterId,
      deviceId,
      label: meterId === 'load-a' ? 'HVAC' : 'Lighting',
      state: 'CONFIDENT',
      telemetryStatus: 'TELEMETRY_OFFLINE',
    },
    incomingEdge: { ...reviewedEdge, child: meterId },
    children: [],
  });
  const forest: TopologyTreeItem[] = [{
    node: {
      meterId: 'grid',
      deviceId: 'D-GRID',
      label: 'Main grid',
      state: 'CONFIDENT',
      telemetryStatus: 'ONLINE',
    },
    incomingEdge: null,
    children: [child('load-a', 'D-A'), child('load-b', 'D-B')],
  }];

  const markup = renderToStaticMarkup(createElement(TopologyTreeDiagram, {
    forest,
    rootMeterId: 'grid',
  }));

  assert.match(markup, /Site root/u);
  assert.match(markup, /Child of Main grid/u);
  assert.match(markup, /Sibling 1\/2/u);
  assert.match(markup, /Sibling 2\/2/u);
  assert.match(markup, /data-topology-connector="grid-&gt;load-a"/u);
  assert.match(markup, /data-topology-relation="reviewed"/u);
  assert.match(markup, /Reviewed relation/u);
  assert.match(markup, /Operator-reviewed site evidence/u);
  assert.doesNotMatch(markup, /stroke-dasharray/u);
  assert.doesNotMatch(markup, /TELEMETRY_OFFLINE|Telemetry offline/u);
});

test('topology diagram identifies a disconnected partial branch without calling it the site root', () => {
  const forest: TopologyTreeItem[] = [{
    node: { meterId: 'panel', deviceId: 'D-PANEL', label: 'Panel', state: 'CONFIDENT' },
    incomingEdge: null,
    children: [],
  }];

  const markup = renderToStaticMarkup(createElement(TopologyTreeDiagram, {
    forest,
    rootMeterId: 'grid',
  }));

  assert.match(markup, /Branch root — upstream not shown/u);
  assert.doesNotMatch(markup, /Site root/u);
});
