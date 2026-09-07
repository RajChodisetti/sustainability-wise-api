import { createFormSubmission } from '@/modules/installhub/lib/model';
import {
  boardTypeLabel,
  meterDevices,
} from '@/modules/installhub/lib/workflow';
import type {
  FormSubmission,
  InstallationTree,
  InstallHubUser,
  MeterDevice,
} from '@/modules/installhub/types/domain';
import { replacementMeterNumbersFromStored } from '@/modules/installhub/components/ReplacementMeterPicker';

export type DeviceSearchRecord = {
  installationId: string;
  siteName: string;
  zoneId: string;
  zoneName: string;
  boardId: string;
  boardName: string;
  boardType: string;
  meterId: string;
  deviceName: string;
  deviceDisplayName: string;
  deviceCustomName: string;
  deviceModel: string;
  supportsCommsReplacement: boolean;
  serialNumber: string;
  deviceNumber: string;
  searchText: string;
};

export function humanDeviceName(meter: MeterDevice): string {
  const manufacturer = meter.deviceFamily === 'OTHER'
    ? meter.customManufacturerName?.trim()
    : 'Wattwatchers';
  const model = meter.deviceModel === 'OTHER'
    ? meter.customModelName?.trim() || 'metering device'
    : meter.deviceModel;
  return [manufacturer, model].filter(Boolean).join(' ');
}

function distinctDeviceDisplayName(meter: MeterDevice, deviceName: string): string {
  const displayName = meter.displayName.value.trim();
  if (!displayName) return '';
  const normalize = (value: string) => value
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-AU');
  return normalize(displayName) === normalize(deviceName) ? '' : displayName;
}

export function deviceSearchRecords(trees: InstallationTree[]): DeviceSearchRecord[] {
  return trees.flatMap((tree) => meterDevices(tree)
    .filter((meter) => !meter.lifecycleState || meter.lifecycleState === 'ACTIVE')
    .flatMap((meter) => {
      const board = tree.electricalAssets.find((item) => item.id === meter.installedOnBoardId);
      if (!board) return [];
      const zone = tree.zones.find((item) => item.id === board.zoneId);
      const deviceName = humanDeviceName(meter);
      const deviceDisplayName = distinctDeviceDisplayName(meter, deviceName);
      const deviceCustomName = meter.customName?.trim() || '';
      const boardType = boardTypeLabel(board);
      const record: DeviceSearchRecord = {
        installationId: tree.installation.id,
        siteName: tree.installation.siteName,
        zoneId: board.zoneId,
        zoneName: zone?.zoneName || 'Unknown zone',
        boardId: board.id,
        boardName: board.assetName,
        boardType,
        meterId: meter.id,
        deviceName,
        deviceDisplayName,
        deviceCustomName,
        deviceModel: meter.deviceModel === 'OTHER'
          ? meter.customModelName?.trim() || 'Other device'
          : meter.deviceModel,
        supportsCommsReplacement: meter.deviceFamily === 'WATTWATCHERS'
          && (meter.deviceModel === 'A3RM' || meter.deviceModel === 'A6M'),
        serialNumber: meter.serialNumber,
        deviceNumber: meter.deviceNumber?.trim() || '',
        searchText: '',
      };
      record.searchText = [
        record.siteName,
        record.zoneName,
        record.boardName,
        record.boardType,
        record.deviceName,
        record.deviceDisplayName,
        record.deviceCustomName,
        record.deviceModel,
        record.serialNumber,
        record.deviceNumber,
        meter.displayName.value,
        meter.deviceFamily,
      ].join(' ').toLocaleLowerCase('en-AU');
      return [record];
    }))
    .sort((left, right) => (
      left.siteName.localeCompare(right.siteName)
      || left.zoneName.localeCompare(right.zoneName)
      || left.boardName.localeCompare(right.boardName)
      || left.deviceName.localeCompare(right.deviceName)
      || left.serialNumber.localeCompare(right.serialNumber)
    ));
}

export function filterDeviceSearchRecords(
  records: DeviceSearchRecord[],
  query: string,
  installationId?: string | null,
): DeviceSearchRecord[] {
  const tokens = query
    .trim()
    .toLocaleLowerCase('en-AU')
    .split(/\s+/)
    .filter(Boolean);
  return records.filter((record) => (
    (!installationId || record.installationId === installationId)
    && tokens.every((token) => record.searchText.includes(token))
  ));
}

export function createReplacementForm(
  tree: InstallationTree,
  user: InstallHubUser,
  record: Pick<DeviceSearchRecord, 'zoneId' | 'boardId' | 'meterId'>,
): FormSubmission {
  const meter = meterDevices(tree).find((item) => item.id === record.meterId);
  if (
    meter?.deviceFamily !== 'WATTWATCHERS'
    || (meter.deviceModel !== 'A3RM' && meter.deviceModel !== 'A6M')
  ) {
    throw new Error('The comms-fault replacement form supports A3RM and A6M devices only.');
  }
  const board = tree.electricalAssets.find((item) => item.id === record.boardId);
  if (
    !board
    || board.zoneId !== record.zoneId
    || meter.installedOnBoardId !== record.boardId
  ) {
    throw new Error('The selected device is not installed on this switchboard. Refresh the installation and try again.');
  }
  const form = createFormSubmission(tree, 'comms-fault', user, record);
  form.answers['works.replace_device'] = 'yes';
  tree.formSubmissions.push(form);
  return form;
}

export function createPlannedReplacementForm(
  tree: InstallationTree,
  user: InstallHubUser,
  context: {
    boardId: string;
    deviceModel: 'A3RM' | 'A6M';
    meterNumber: string;
  },
): FormSubmission {
  if (tree.installation.status === 'Completed') {
    throw new Error('Reopen this completed installation before replacing its device.');
  }
  if (tree.installation.serviceType !== 'M2 - Faults / COMMS fault') {
    throw new Error('This installation is not an M2 COMMS fault job.');
  }
  const plannedMeter = replacementMeterNumbersFromStored(tree.installation.existingDeviceId)
    .find((value) => value.toLocaleLowerCase('en-AU') === context.meterNumber.trim().toLocaleLowerCase('en-AU'));
  if (!plannedMeter) {
    throw new Error('This meter is not in the current M2 replacement plan. Refresh the installation and try again.');
  }
  const board = tree.electricalAssets.find((item) => item.id === context.boardId);
  if (!board || !tree.zones.some((zone) => zone.id === board.zoneId)) {
    throw new Error('Select a current switchboard for this planned meter.');
  }
  const plannedKey = plannedMeter.toLocaleLowerCase('en-AU');
  const duplicate = meterDevices(tree).find((meter) => (
    (!meter.lifecycleState || meter.lifecycleState === 'ACTIVE')
    && [meter.serialNumber, meter.deviceNumber]
      .filter(Boolean)
      .some((value) => value!.trim().toLocaleLowerCase('en-AU') === plannedKey)
  ));
  if (duplicate) {
    throw new Error('This meter is now in the site data. Open that device and start the replacement from it.');
  }
  const form = createFormSubmission(tree, 'comms-fault', user, {
    zoneId: board.zoneId,
    boardId: board.id,
  });
  form.answers['existing.device_type'] = context.deviceModel;
  form.answers['existing.device_id'] = plannedMeter;
  form.answers['works.replace_device'] = 'yes';
  tree.formSubmissions.push(form);
  return form;
}

export function createDeviceCommissioningForm(
  tree: InstallationTree,
  user: InstallHubUser,
  context: { zoneId: string; boardId: string },
): FormSubmission {
  const form = createFormSubmission(tree, 'ww-installation', user, context);
  tree.formSubmissions.push(form);
  return form;
}
