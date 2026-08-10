import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTH_QUERY_MAX_RETRIES,
  authQueryRetryDelayMs,
  isDefinitiveAuthError,
  isSessionCheckLoading,
  isTransientAuthQueryError,
  shouldRetryAuthQuery,
} from './authQuery';

test('classifies definitive auth loss separately from transient failures', () => {
  assert.equal(isDefinitiveAuthError({ type: 'auth' }), true);
  assert.equal(isDefinitiveAuthError({ status: 403 }), true);
  assert.equal(isDefinitiveAuthError({ status: 500 }), false);
  assert.equal(isTransientAuthQueryError({ type: 'network' }), true);
  assert.equal(isTransientAuthQueryError({ status: 429 }), true);
  assert.equal(isTransientAuthQueryError({ status: 503 }), true);
  assert.equal(isTransientAuthQueryError({ status: 401 }), false);
});

test('retries transient auth checks only while the app token remains', () => {
  assert.equal(shouldRetryAuthQuery({ status: 503 }, true), true);
  assert.equal(shouldRetryAuthQuery({ status: 503 }, false), false);
  assert.equal(shouldRetryAuthQuery({ status: 401 }, true), false);
  assert.equal(
    shouldRetryAuthQuery({ status: 503 }, true, AUTH_QUERY_MAX_RETRIES),
    false,
  );
});

test('caps and jitters auth query retry delay', () => {
  assert.equal(authQueryRetryDelayMs(0, 0), 375);
  assert.equal(authQueryRetryDelayMs(20, 1), 4_000);
});

test('session check loading ends after settled error so login can render', () => {
  assert.equal(
    isSessionCheckLoading({
      isClient: true,
      hasToken: true,
      hasUser: false,
      isPending: false,
      isFetching: false,
      isError: true,
    }),
    false,
  );
  assert.equal(
    isSessionCheckLoading({
      isClient: true,
      hasToken: true,
      hasUser: false,
      isPending: true,
      isFetching: true,
      isError: false,
    }),
    true,
  );
  assert.equal(
    isSessionCheckLoading({
      isClient: true,
      hasToken: false,
      hasUser: false,
      isPending: false,
      isFetching: false,
      isError: false,
    }),
    false,
  );
});
