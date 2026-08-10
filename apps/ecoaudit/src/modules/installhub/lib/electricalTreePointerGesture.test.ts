import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ELECTRICAL_TREE_DRAG_SLOP_PX,
  ELECTRICAL_TREE_HOLD_DELAY_MS,
  ELECTRICAL_TREE_HOLD_SLOP_PX,
  electricalTreePointerGestureTransition,
  type ElectricalTreePointerGesturePhase,
} from './electricalTreePointerGesture';

test('electrical map pointer gesture uses an intentional hold with stable thresholds', () => {
  assert.equal(ELECTRICAL_TREE_HOLD_DELAY_MS, 425);
  assert.equal(ELECTRICAL_TREE_HOLD_SLOP_PX, 10);
  assert.equal(ELECTRICAL_TREE_DRAG_SLOP_PX, 3);

  assert.equal(electricalTreePointerGestureTransition('pressing', {
    type: 'move',
    deltaX: 6,
    deltaY: 8,
  }), 'pressing');
  assert.equal(electricalTreePointerGestureTransition('pressing', {
    type: 'move',
    deltaX: 6.01,
    deltaY: 8,
  }), 'cancelled');
  assert.equal(electricalTreePointerGestureTransition('pressing', { type: 'hold' }), 'held');
  assert.equal(electricalTreePointerGestureTransition('held', {
    type: 'move',
    deltaX: 2.99,
    deltaY: 0,
  }), 'held');
  assert.equal(electricalTreePointerGestureTransition('held', {
    type: 'move',
    deltaX: 3,
    deltaY: 0,
  }), 'dragging');
});

test('electrical map pointer gesture measures diagonal screen-space movement', () => {
  assert.equal(electricalTreePointerGestureTransition('pressing', {
    type: 'move',
    deltaX: -8,
    deltaY: -6,
  }), 'pressing');
  assert.equal(electricalTreePointerGestureTransition('pressing', {
    type: 'move',
    deltaX: 8,
    deltaY: 6.1,
  }), 'cancelled');
  assert.equal(electricalTreePointerGestureTransition('held', {
    type: 'move',
    deltaX: 1.8,
    deltaY: 2.4,
  }), 'dragging');
});

test('electrical map pointer gesture fails closed for non-finite movement', () => {
  for (const phase of ['pressing', 'held'] satisfies ElectricalTreePointerGesturePhase[]) {
    assert.equal(electricalTreePointerGestureTransition(phase, {
      type: 'move',
      deltaX: Number.NaN,
      deltaY: 0,
    }), 'cancelled');
    assert.equal(electricalTreePointerGestureTransition(phase, {
      type: 'move',
      deltaX: 0,
      deltaY: Number.POSITIVE_INFINITY,
    }), 'cancelled');
  }
});

test('cancelled and dragging pointer gestures are terminal', () => {
  assert.equal(
    electricalTreePointerGestureTransition('cancelled', { type: 'hold' }),
    'cancelled',
    'a late hold timer must not revive a cancelled press',
  );
  assert.equal(electricalTreePointerGestureTransition('cancelled', {
    type: 'move',
    deltaX: 20,
    deltaY: 20,
  }), 'cancelled');
  assert.equal(electricalTreePointerGestureTransition('dragging', { type: 'hold' }), 'dragging');
  assert.equal(electricalTreePointerGestureTransition('dragging', {
    type: 'move',
    deltaX: Number.NaN,
    deltaY: Number.NaN,
  }), 'dragging');
});
