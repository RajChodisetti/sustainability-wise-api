import { and, eq, isNull } from 'drizzle-orm';
import type { AuthUser } from '../auth/middleware.js';
import { db } from '../db/client.js';
import { eaAudits } from '../db/schema/ecoaudit.js';
import { ihInstallations } from '../db/schema/installhub.js';
import { ssSites } from '../db/schema/solarsense.js';
import { assertAuditAccess } from '../routes/ecoaudit/helpers.js';
import { assertInstallationAccess } from '../routes/installhub/helpers.js';
import { assertSiteAccess } from '../routes/solarsense/helpers.js';
import { notFound } from '../utils/errors.js';
import { hasAccessibleCopyReference } from './photoCopyReferences.js';
import {
  findConfirmedPhotoById,
  resolveConfirmedPhotoReference,
  type ConfirmedPhotoReference,
} from './photoRegistryReferences.js';

export async function authorizePhoto(
  photo: ConfirmedPhotoReference,
  user: AuthUser,
): Promise<ConfirmedPhotoReference> {
  if (user.app === 'wattwatchers') throw notFound('Photo');
  let directAccessError: unknown;
  if (user.app === 'ecoaudit') {
    const [audit] = await db
      .select()
      .from(eaAudits)
      .where(and(eq(eaAudits.id, photo.parentId), isNull(eaAudits.deletedAt)))
      .limit(1);
    if (audit) {
      try {
        assertAuditAccess(audit, user);
        return photo;
      } catch (error) {
        directAccessError = error;
      }
    }
  } else if (user.app === 'solarsense') {
    const [site] = await db
      .select()
      .from(ssSites)
      .where(and(eq(ssSites.id, photo.parentId), isNull(ssSites.deletedAt)))
      .limit(1);
    if (site) {
      try {
        assertSiteAccess(site, user);
        return photo;
      } catch (error) {
        directAccessError = error;
      }
    }
  } else if (user.app === 'installhub') {
    const [installation] = await db
      .select()
      .from(ihInstallations)
      .where(and(
        eq(ihInstallations.id, photo.parentId),
        isNull(ihInstallations.deletedAt),
      ))
      .limit(1);
    if (installation) {
      try {
        assertInstallationAccess(installation, user);
        return photo;
      } catch (error) {
        directAccessError = error;
      }
    }
  }

  if (await hasAccessibleCopyReference(photo.id, user)) return photo;
  if (directAccessError) throw directAccessError;
  throw notFound('Photo');
}

export async function loadAuthorizedPhotoByReference(
  storageKey: string,
  user: AuthUser,
): Promise<ConfirmedPhotoReference> {
  if (user.app === 'wattwatchers') throw notFound('Photo');
  const photo = await resolveConfirmedPhotoReference(storageKey, user.app);
  if (!photo) throw notFound('Photo');
  return authorizePhoto(photo, user);
}

export async function loadAuthorizedPhotoById(
  photoId: string,
  user: AuthUser,
): Promise<ConfirmedPhotoReference> {
  if (user.app === 'wattwatchers') throw notFound('Photo');
  const photo = await findConfirmedPhotoById(photoId, user.app);
  if (!photo) throw notFound('Photo');
  return authorizePhoto(photo, user);
}
