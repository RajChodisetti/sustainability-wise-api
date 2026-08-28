import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveInvoiceEmailStaleClaimMs,
  isInvoiceEmailRuntimeConfigured,
  isValidInvoiceEmailMailbox,
  MAX_SCHEDULER_INVOICE_EMAIL_ATTACHMENT_BYTES,
  parseInvoiceEmailEnabled,
  resolveInvoiceEmailFromEmail,
  resolveInvoiceEmailMaxAttachmentBytes,
} from '../config.js';
import {
  buildSchedulerInvoiceEmailRaw,
  createGmailInvoiceEmailTransport,
} from './schedulerInvoiceEmailWorker.js';
import {
  MAX_SCHEDULER_INVOICE_EMAIL_RECIPIENTS,
  normalizeInvoiceRecipient,
  schedulerInvoiceEmailAttachmentFromQueuedPdf,
  schedulerInvoiceEmailRequestFingerprint,
} from './schedulerInvoiceEmailService.js';

const submission = {
  deliveryId: 'delivery-123',
  recipient: 'accounts@example.test',
  subject: 'Invoice INV-2026-001 — Solar',
  message: 'Hello Accounts,\n\nPlease find the invoice attached.',
  attachmentFilename: 'Solar job – 2026-08-16.pdf',
  attachment: Buffer.from('%PDF-1.7\ninvoice bytes\n%%EOF'),
};

test('empty Wattwatchers FROM_EMAIL falls back to the existing SMTP_USER sender', () => {
  assert.equal(
    resolveInvoiceEmailFromEmail('', 'reports@sustainabilitywise.example'),
    'reports@sustainabilitywise.example',
  );
  assert.equal(
    resolveInvoiceEmailFromEmail(' invoices@example.test ', 'reports@example.test'),
    'invoices@example.test',
  );
  assert.equal(parseInvoiceEmailEnabled(undefined), false);
  assert.equal(parseInvoiceEmailEnabled('false'), false);
  assert.equal(parseInvoiceEmailEnabled('true'), true);
  assert.equal(parseInvoiceEmailEnabled(' true '), true);
  assert.equal(isValidInvoiceEmailMailbox('reports@example.test'), true);
  assert.equal(isValidInvoiceEmailMailbox('Reports <reports@example.test>'), false);
  assert.equal(isValidInvoiceEmailMailbox('one@example.test,two@example.test'), false);
  assert.equal(isValidInvoiceEmailMailbox('reports@example.test\r\nBcc: victim@example.test'), false);
  const runtimeConfig = {
    deliveryMethod: 'gmail_api',
    gmailClientId: 'client-id',
    gmailClientSecret: 'client-secret',
    gmailRefreshToken: 'refresh-token',
    fromEmail: 'reports@example.test',
  };
  assert.equal(isInvoiceEmailRuntimeConfigured(runtimeConfig), true);
  assert.equal(isInvoiceEmailRuntimeConfigured({
    ...runtimeConfig,
    fromEmail: 'reports@example.test\r\nBcc: victim@example.test',
  }), false);
  assert.equal(
    resolveInvoiceEmailMaxAttachmentBytes(undefined),
    MAX_SCHEDULER_INVOICE_EMAIL_ATTACHMENT_BYTES,
  );
  assert.equal(
    resolveInvoiceEmailMaxAttachmentBytes(String(20 * 1024 * 1024)),
    MAX_SCHEDULER_INVOICE_EMAIL_ATTACHMENT_BYTES,
  );
  assert.equal(resolveInvoiceEmailMaxAttachmentBytes('1048576'), 1048576);
  assert.equal(deriveInvoiceEmailStaleClaimMs(30_000, 20_000), 70_000);
  assert.equal(deriveInvoiceEmailStaleClaimMs(120_000, 20_000), 120_000);
});

test('invoice recipient and idempotency fingerprint reject header injection and stay stable', () => {
  assert.equal(normalizeInvoiceRecipient(' accounts+solar@example.test '), 'accounts+solar@example.test');
  assert.equal(
    normalizeInvoiceRecipient(
      'accounts@example.test; manager@example.test, ACCOUNTS@example.test',
    ),
    'accounts@example.test, manager@example.test',
  );
  assert.throws(
    () => normalizeInvoiceRecipient('victim@example.test\r\nBcc: attacker@example.test'),
    /Bad request/,
  );
  assert.throws(() => normalizeInvoiceRecipient('not-an-address'), /Bad request/);
  assert.throws(
    () => normalizeInvoiceRecipient('valid@example.test, Bcc:attacker@example.test'),
    /Bad request/,
  );
  assert.throws(
    () => normalizeInvoiceRecipient('valid@example.test; '),
    /Bad request/,
  );
  assert.throws(
    () => normalizeInvoiceRecipient(`${'a'.repeat(245)}@example.test`),
    /Bad request/,
  );
  assert.throws(
    () => normalizeInvoiceRecipient(
      Array.from(
        { length: MAX_SCHEDULER_INVOICE_EMAIL_RECIPIENTS + 1 },
        (_, index) => `recipient${index}@example.test`,
      ).join(','),
    ),
    /Bad request/,
  );
  const input = {
    expectedUpdatedAt: '2026-08-16T12:00:00.000Z',
    recipient: 'accounts@example.test',
    subject: 'Invoice 1',
    message: 'Attached',
  };
  assert.equal(
    schedulerInvoiceEmailRequestFingerprint(input),
    schedulerInvoiceEmailRequestFingerprint({ ...input }),
  );
  assert.notEqual(
    schedulerInvoiceEmailRequestFingerprint(input),
    schedulerInvoiceEmailRequestFingerprint({ ...input, recipient: 'other@example.test' }),
  );
});

test('invoice email pins the exact queued PDF filename instead of recomputing version one', () => {
  const attachment = schedulerInvoiceEmailAttachmentFromQueuedPdf({
    entityId: 'invoice-1',
    entityType: 'scheduler_invoice',
    params: {
      artifactType: 'pdf',
      filename: 'invoice-job-INV-1-v2.pdf',
      contentType: 'application/pdf',
      sourceUpdatedAt: '2026-08-16T12:00:00.000Z',
      reportVariantKey: 'scheduler-invoice-pdf:v3:invoice-1:revision-2',
      invoiceVersion: 2,
    },
  }, {
    invoiceId: 'invoice-1',
    sourceUpdatedAt: '2026-08-16T12:00:00.000Z',
    reportVariantKey: 'scheduler-invoice-pdf:v3:invoice-1:revision-2',
  });
  assert.deepEqual(attachment, {
    filename: 'invoice-job-INV-1-v2.pdf',
    contentType: 'application/pdf',
  });
  assert.notEqual(attachment.filename, 'invoice-job-INV-1-v1.pdf');
  assert.throws(() => schedulerInvoiceEmailAttachmentFromQueuedPdf({
    entityId: 'invoice-1',
    entityType: 'scheduler_invoice',
    params: {
      artifactType: 'pdf',
      filename: 'invoice-job-INV-1-v2.pdf',
      contentType: 'text/plain',
      sourceUpdatedAt: '2026-08-16T12:00:00.000Z',
      reportVariantKey: 'scheduler-invoice-pdf:v3:invoice-1:revision-2',
    },
  }, {
    invoiceId: 'invoice-1',
    sourceUpdatedAt: '2026-08-16T12:00:00.000Z',
    reportVariantKey: 'scheduler-invoice-pdf:v3:invoice-1:revision-2',
  }), /Conflict/);
});

test('invoice Gmail raw message has a stable identity and exact PDF attachment', () => {
  const raw = buildSchedulerInvoiceEmailRaw({
    ...submission,
    recipient: 'accounts@example.test, manager@example.test',
  }, {
    fromEmail: 'reports@sustainabilitywise.example',
    fromName: 'Sustainability Wise',
  });
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(mime, /Message-ID: <scheduler-invoice-delivery-123@sustainabilitywise\.example>/);
  assert.match(mime, /X-Sustainability-Wise-Delivery-ID: delivery-123/);
  assert.match(mime, /To: accounts@example\.test,\r\n manager@example\.test/);
  assert.match(mime, /Content-Type: application\/pdf/);
  assert.match(mime, /filename\*=UTF-8''Solar%20job%20%E2%80%93%202026-08-16\.pdf/);
  assert.match(mime, new RegExp(submission.attachment.toString('base64')));
  assert.doesNotMatch(mime, /invoice bytes/);
});

test('multi-recipient To headers fold safely and preserve every canonical recipient', () => {
  const recipient = normalizeInvoiceRecipient(Array.from(
    { length: MAX_SCHEDULER_INVOICE_EMAIL_RECIPIENTS },
    (_, index) => `${'account'.repeat(8)}-${index}@example.test`,
  ).join(';'));
  const raw = buildSchedulerInvoiceEmailRaw({ ...submission, recipient }, {
    fromEmail: 'reports@sustainabilitywise.example',
    fromName: 'Sustainability Wise',
  });
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  const headerLines = mime
    .slice(0, mime.indexOf('\r\n\r\n'))
    .split('\r\n');
  const toStart = headerLines.findIndex((line) => line.startsWith('To: '));
  assert.ok(toStart >= 0);
  let toEnd = toStart + 1;
  while (toEnd < headerLines.length && headerLines[toEnd]!.startsWith(' ')) {
    toEnd += 1;
  }
  const toLines = headerLines.slice(toStart, toEnd);
  assert.equal(toLines.length, MAX_SCHEDULER_INVOICE_EMAIL_RECIPIENTS);
  assert.equal(
    toLines.map((line, index) => index === 0 ? line : line.slice(1)).join(' '),
    `To: ${recipient}`,
  );
  assert.ok(toLines.every((line) => Buffer.byteLength(line, 'utf8') <= 998));
});

test('maximum Unicode invoice subjects use folded RFC 2047 encoded-words', () => {
  const raw = buildSchedulerInvoiceEmailRaw({
    ...submission,
    subject: '界'.repeat(500),
  }, {
    fromEmail: 'reports@sustainabilitywise.example',
    fromName: 'Sustainability Wise',
  });
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  const headerBlock = mime.slice(0, mime.indexOf('\r\n\r\n'));
  const physicalLines = headerBlock.split('\r\n');
  const subjectStart = physicalLines.indexOf('Subject:');
  assert.ok(subjectStart >= 0);
  let subjectEnd = subjectStart + 1;
  while (subjectEnd < physicalLines.length && physicalLines[subjectEnd]!.startsWith(' ')) {
    subjectEnd += 1;
  }
  const subjectLines = physicalLines.slice(subjectStart + 1, subjectEnd);
  assert.ok(subjectLines.length > 1);
  for (const line of subjectLines) {
    assert.ok(line.startsWith(' =?UTF-8?B?'));
    assert.ok(line.trim().length <= 75);
    assert.ok(Buffer.byteLength(line, 'utf8') <= 78);
  }
  const unfolded = subjectLines.map((line) => line.trim()).join(' ');
  const decoded = unfolded.split(/\s+/u).map((word) => {
    const match = /^=\?UTF-8\?B\?(.+)\?=$/iu.exec(word);
    assert.ok(match);
    return Buffer.from(match[1]!, 'base64').toString('utf8');
  }).join('');
  assert.equal(decoded, '界'.repeat(500));
});

test('Gmail transport refreshes OAuth before submitting and returns the provider id', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input).includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'test-access-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ id: 'gmail-message-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const transport = createGmailInvoiceEmailTransport(fakeFetch);
  const prepared = await transport.prepare();
  const result = await transport.submit(prepared, submission);
  assert.equal(result.providerMessageId, 'gmail-message-1');
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, 'https://oauth2.googleapis.com/token');
  assert.match(calls[1]?.url ?? '', /gmail\.googleapis\.com\/gmail\/v1\/users\//);
  assert.equal(
    (calls[1]?.init?.headers as Record<string, string>).authorization,
    'Bearer test-access-token',
  );
  const body = JSON.parse(String(calls[1]?.init?.body)) as { raw?: unknown };
  assert.equal(typeof body.raw, 'string');
});

test('pre-submit OAuth outages are retryable while ambiguous Gmail sends are not', async () => {
  const oauthOutageFetch: typeof fetch = async () => new Response('', { status: 503 });
  const oauthOutage = createGmailInvoiceEmailTransport(oauthOutageFetch);
  await assert.rejects(
    oauthOutage.prepare(),
    (error: unknown) => (
      error instanceof Error
      && error.name === 'SafeRetryableEmailError'
      && error.message === 'gmail_oauth_unavailable'
    ),
  );

  let calls = 0;
  const ambiguousSend = createGmailInvoiceEmailTransport(async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ access_token: 'token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error('connection lost after request write');
  });
  const prepared = await ambiguousSend.prepare();
  await assert.rejects(
    ambiguousSend.submit(prepared, submission),
    (error: unknown) => (
      error instanceof Error
      && error.name === 'AmbiguousEmailError'
      && error.message === 'gmail_delivery_outcome_unknown'
    ),
  );
});

test('a concrete Gmail rate-limit rejection is classified as safely retryable', async () => {
  let calls = 0;
  const transport = createGmailInvoiceEmailTransport(async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ access_token: 'token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('', { status: 429 });
  });
  const prepared = await transport.prepare();
  await assert.rejects(
    transport.submit(prepared, submission),
    (error: unknown) => (
      error instanceof Error
      && error.name === 'SafeRetryableEmailError'
      && error.message === 'gmail_send_rejected_429'
    ),
  );
});
