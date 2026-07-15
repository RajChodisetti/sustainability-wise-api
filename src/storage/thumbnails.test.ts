import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.STORAGE_PROVIDER = 'local';

const { renderThumbnail } = await import('./thumbnails.js');

test('renders a landscape image as a bounded JPEG thumbnail', async () => {
  const original = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: '#336699',
    },
  }).jpeg().toBuffer();

  const thumbnail = await renderThumbnail(original);
  const metadata = await sharp(thumbnail).metadata();

  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 400);
  assert.equal(metadata.height, 300);
});

test('does not enlarge an image narrower than the thumbnail bound', async () => {
  const original = await sharp({
    create: {
      width: 240,
      height: 320,
      channels: 3,
      background: '#ffffff',
    },
  }).png().toBuffer();

  const thumbnail = await renderThumbnail(original);
  const metadata = await sharp(thumbnail).metadata();

  assert.equal(metadata.width, 240);
  assert.equal(metadata.height, 320);
});
