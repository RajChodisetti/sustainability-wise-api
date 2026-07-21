import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
process.env.STORAGE_PROVIDER = 'local';

test('writePhotoZip consumes each object stream before opening the next one', async () => {
  const { writePhotoZip } = await import('./photoZipExport.js');
  const photos = Array.from({ length: 80 }, (_, index) => ({
    id: String(index),
    storageKey: `photo-${index}.jpg`,
  }));
  const zipChunks: Buffer[] = [];
  let activeStreams = 0;
  let maxActiveStreams = 0;

  const destination = new Writable({
    write(chunk, _encoding, callback) {
      zipChunks.push(Buffer.from(chunk));
      callback();
    },
  });

  const result = await writePhotoZip({
    photos,
    destination,
    entryName: (photo) => photo.storageKey!,
    openStream: async (storageKey) => {
      activeStreams += 1;
      maxActiveStreams = Math.max(maxActiveStreams, activeStreams);
      let sent = false;
      return new Readable({
        read() {
          if (sent) return;
          sent = true;
          setTimeout(() => {
            this.push(Buffer.from(storageKey));
            this.push(null);
          }, 2);
        },
        destroy(error, callback) {
          activeStreams -= 1;
          callback(error);
        },
      });
    },
  });

  const zip = Buffer.concat(zipChunks);
  assert.equal(result.added, photos.length);
  assert.equal(result.skipped, 0);
  assert.equal(maxActiveStreams, 1);
  assert.equal(zip.subarray(0, 2).toString('ascii'), 'PK');
});
