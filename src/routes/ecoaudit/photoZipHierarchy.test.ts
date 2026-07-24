import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import { writePhotoZip } from '../../services/photoZipExport.js';
import {
  createEcoAuditPhotoZipEntryNamer,
  parseEcoAuditPhotoZipMode,
  resolveEcoAuditPhotoCaption,
  type EcoAuditPhotoZipContext,
} from './photoZipHierarchy.js';

function contextFor(
  entityType: string,
  entityId: string,
  values: { zoneName: string; sectionTitle: string; itemLabel: string; photoDescs?: unknown },
): EcoAuditPhotoZipContext {
  return {
    entities: new Map([[`${entityType}:${entityId}`, {
      ...values,
      photoDescs: values.photoDescs ?? {},
    }]]),
  };
}

test('by-zone ZIP paths match the mobile zone, section, item, caption hierarchy', () => {
  const context = contextFor('main_switchboard', 'item-1', {
    zoneName: 'Building A',
    sectionTitle: 'Electrical Infrastructure',
    itemLabel: 'MSB 1',
    photoDescs: { photo: { name: 'Incoming supply' } },
  });
  const entryName = createEcoAuditPhotoZipEntryNamer(context, 'by-zone');

  assert.equal(entryName({
    entityType: 'main_switchboard',
    entityId: 'item-1',
    fieldName: 'photo',
    originalFilename: 'photo_123.jpg',
    contentType: 'image/jpeg',
  }), 'Building_A/Electrical_Infrastructure/MSB_1/Incoming_supply.jpg');
});

test('by-equipment ZIP paths put the report section before the named zone', () => {
  const context = contextFor('hvac_unit', 'hvac-1', {
    zoneName: 'Warehouse / North',
    sectionTitle: 'HVAC Systems',
    itemLabel: 'Office AC 1',
  });
  const entryName = createEcoAuditPhotoZipEntryNamer(context, 'by-equipment');

  assert.equal(entryName({
    entityType: 'hvac_unit',
    entityId: 'hvac-1',
    fieldName: 'controllerPhoto',
    originalFilename: 'controller.png',
    contentType: 'image/png',
  }), 'HVAC_Systems/Warehouse_North/Office_AC_1/Controller.png');
});

test('zone photos retain the same nested mobile hierarchy and custom captions', () => {
  const context = contextFor('zone', 'zone-1', {
    zoneName: 'Main Building',
    sectionTitle: 'Zone Photos',
    itemLabel: 'Main Building',
    photoDescs: { 'photos.0': { name: 'Front entrance' } },
  });
  const entryName = createEcoAuditPhotoZipEntryNamer(context, 'by-zone');

  assert.equal(entryName({
    entityType: 'zone',
    entityId: 'zone-1',
    fieldName: 'photos[0]',
    originalFilename: 'entrance.jpeg',
    contentType: 'image/jpeg',
  }), 'Main_Building/Zone_Photos/Main_Building/Front_entrance.jpeg');
});

test('duplicate human-readable photo names receive deterministic suffixes', () => {
  const context = contextFor('additional_switchboard', 'board-1', {
    zoneName: 'Building B',
    sectionTitle: 'Electrical Infrastructure',
    itemLabel: 'Distribution Board',
    photoDescs: {
      'extraPhotos.0': { name: 'Panel detail' },
      'extraPhotos.1': { name: 'Panel detail' },
    },
  });
  const entryName = createEcoAuditPhotoZipEntryNamer(context, 'by-zone');
  const base = {
    entityType: 'additional_switchboard',
    entityId: 'board-1',
    originalFilename: 'photo.jpg',
    contentType: 'image/jpeg',
  };

  assert.equal(
    entryName({ ...base, fieldName: 'extraPhotos[0]' }),
    'Building_B/Electrical_Infrastructure/Distribution_Board/Panel_detail.jpg',
  );
  assert.equal(
    entryName({ ...base, fieldName: 'extraPhotos[1]' }),
    'Building_B/Electrical_Infrastructure/Distribution_Board/Panel_detail_1.jpg',
  );
});

test('legacy lighting field aliases resolve canonical metadata names', () => {
  const context = contextFor('lighting_system', 'light-1', {
    zoneName: 'Factory',
    sectionTitle: 'Lighting Systems',
    itemLabel: 'High Bay',
    photoDescs: { switchboardControlsPhoto: { name: 'Lighting controls' } },
  });
  const entryName = createEcoAuditPhotoZipEntryNamer(context, 'by-zone');

  assert.equal(entryName({
    entityType: 'lighting_system',
    entityId: 'light-1',
    fieldName: 'switchboard_photo_notes',
    originalFilename: null,
    contentType: 'image/jpeg',
  }), 'Factory/Lighting_Systems/High_Bay/Lighting_controls.jpg');
});

test('photo-list captions use the same canonical scalar and array lookup as ZIP exports', () => {
  const arrayContext = contextFor('zone', 'zone-1', {
    zoneName: 'Factory',
    sectionTitle: 'Zone Photos',
    itemLabel: 'Factory',
    photoDescs: { 'photos.1': { name: 'Rear loading dock' } },
  });
  const lightingContext = contextFor('lighting_system', 'light-1', {
    zoneName: 'Factory',
    sectionTitle: 'Lighting Systems',
    itemLabel: 'High Bay',
    photoDescs: { switchboardControlsPhoto: { name: 'Lighting controls' } },
  });

  assert.equal(resolveEcoAuditPhotoCaption(arrayContext, {
    entityType: 'zone',
    entityId: 'zone-1',
    fieldName: 'photos[1]',
  }), 'Rear loading dock');
  assert.equal(resolveEcoAuditPhotoCaption(lightingContext, {
    entityType: 'lighting_system',
    entityId: 'light-1',
    fieldName: 'switchboard_photo_notes',
  }), 'Lighting controls');
  assert.equal(resolveEcoAuditPhotoCaption(arrayContext, {
    entityType: 'zone',
    entityId: 'missing-zone',
    fieldName: 'photos[1]',
  }), null);
});

test('missing records never expose entity UUIDs as folder names', () => {
  const entryName = createEcoAuditPhotoZipEntryNamer({ entities: new Map() }, 'by-zone');
  const path = entryName({
    entityType: 'hvac_unit',
    entityId: '4afd5a85-ffa8-4669-ba18-7c0e45edf000',
    fieldName: 'photo',
    originalFilename: 'unit.jpg',
    contentType: 'image/jpeg',
  });

  assert.equal(path, 'General/HVAC_Systems/HVAC_Unit/HVAC_Unit.jpg');
  assert.doesNotMatch(path, /4afd5a85/);
});

test('ZIP mode defaults to by-zone and accepts only the equipment variant', () => {
  assert.equal(parseEcoAuditPhotoZipMode(undefined), 'by-zone');
  assert.equal(parseEcoAuditPhotoZipMode('by-zone'), 'by-zone');
  assert.equal(parseEcoAuditPhotoZipMode('by-equipment'), 'by-equipment');
  assert.equal(parseEcoAuditPhotoZipMode('invalid'), 'by-zone');
});

test('the generated ZIP stores the complete human-readable hierarchy', async () => {
  const context = contextFor('main_switchboard', 'item-1', {
    zoneName: 'Building A',
    sectionTitle: 'Electrical Infrastructure',
    itemLabel: 'MSB 1',
    photoDescs: { photo: { name: 'Incoming supply' } },
  });
  const zipChunks: Buffer[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      zipChunks.push(Buffer.from(chunk));
      callback();
    },
  });

  await writePhotoZip({
    photos: [{
      id: 'photo-1',
      storageKey: 'stored/photo-1.jpg',
      entityType: 'main_switchboard',
      entityId: 'item-1',
      fieldName: 'photo',
      originalFilename: 'photo_123.jpg',
      contentType: 'image/jpeg',
    }],
    destination,
    entryName: createEcoAuditPhotoZipEntryNamer(context, 'by-zone'),
    openStream: async () => Readable.from([Buffer.from('photo bytes')]),
  });

  const zip = Buffer.concat(zipChunks);
  assert.equal(zip.subarray(0, 2).toString('ascii'), 'PK');
  assert.ok(zip.includes(Buffer.from(
    'Building_A/Electrical_Infrastructure/MSB_1/Incoming_supply.jpg',
  )));
});
