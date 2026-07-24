import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { verifyFileCapability } from '../auth/fileCapability.js';
import { authenticate } from '../auth/middleware.js';
import {
  contentTypeForStorageKey,
  localFileSize,
  localFileStream,
} from '../storage/localFiles.js';
import { authorizeStoredFile } from '../storage/storedFileAuthorization.js';
import { unauthorized } from '../utils/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    fileCapabilityAuthorized?: boolean;
  }
}

async function requireFileAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const storageKey = (request.params as { '*': string })['*'];
  const query = request.query as { expires?: unknown; signature?: unknown };
  const hasCapabilityField =
    query?.expires !== undefined || query?.signature !== undefined;

  if (hasCapabilityField) {
    if (verifyFileCapability({
      storageKey,
      expires: query.expires,
      signature: query.signature,
      secret: config.fileCapability.secret,
    })) {
      request.fileCapabilityAuthorized = true;
      return;
    }
    if (!request.headers.authorization) {
      throw unauthorized('Invalid or expired file capability');
    }
  } else if (config.fileCapability.allowLegacyPublic) {
    request.fileCapabilityAuthorized = true;
    return;
  }

  await authenticate(request, reply);
  request.fileCapabilityAuthorized = false;
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/files/*', {
    config: {
      rateLimit: { max: 2_000, timeWindow: '1 minute' },
    },
    schema: {
      tags: ['Files'],
      summary: 'Download an authorized stored file by storage key',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [requireFileAccess],
  }, async (request, reply) => {
    const requestedStorageKey = (request.params as { '*': string })['*'];
    const storageKey = request.fileCapabilityAuthorized
      ? requestedStorageKey
      : await authorizeStoredFile(requestedStorageKey, request.user);
    const size = await localFileSize(storageKey);
    const stream = await localFileStream(storageKey);
    return reply
      .header('Content-Length', String(size))
      .header('Cache-Control', 'private, max-age=300')
      .header('Vary', 'Authorization')
      .type(contentTypeForStorageKey(storageKey))
      .send(stream);
  });
}
