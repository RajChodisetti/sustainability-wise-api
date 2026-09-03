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

  const markup = renderToStaticMarkup(createElement(TopologyTreeDiagram, { forest }));

  assert.match(markup, /Root meter/u);
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
