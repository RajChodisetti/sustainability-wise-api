import { randomUUID } from 'node:crypto';
import { closeDb, sql } from '../src/db/client.js';
import {
  deleteLocalFile,
  localFileExists,
  localFileSize,
  localFileStream,
  writeLocalFile,
} from '../src/storage/localFiles.js';
import { config } from '../src/config.js';

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

async function main() {
  console.log(`[option3-smoke] storage provider: ${config.storage.provider}`);
  console.log('[option3-smoke] checking database connection');
  const dbResult = await sql`select now() as now`;
  if (!dbResult[0]?.now) throw new Error('Database check did not return a timestamp');
  console.log('[option3-smoke] database ok');

  console.log('[option3-smoke] checking configured storage');
  const storageKey = `smoke-tests/${Date.now()}-${randomUUID()}.txt`;
  const body = Buffer.from(`option3 smoke ${new Date().toISOString()}\n`);
  const written = await writeLocalFile(storageKey, body);
  if (written.size !== body.length) throw new Error('Storage write size mismatch');
  if (!(await localFileExists(storageKey))) throw new Error('Storage object not found after write');
  const size = await localFileSize(storageKey);
  if (size !== body.length) throw new Error('Storage head size mismatch');
  const downloaded = await readStream(await localFileStream(storageKey));
  if (!downloaded.equals(body)) throw new Error('Storage read content mismatch');
  await deleteLocalFile(storageKey);
  if (await localFileExists(storageKey)) throw new Error('Storage object still exists after delete');
  console.log('[option3-smoke] storage ok');

  console.log('[option3-smoke] ok');
}

main()
  .catch((error) => {
    console.error(`[option3-smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => {});
  });
