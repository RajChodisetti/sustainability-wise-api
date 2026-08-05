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
  deviceModel: string;
  serialNumber: string;
  deviceNumber: string;
  searchText: string;
};

export function humanDeviceName(meter: MeterDevice): string {
  if (meter.displayName.isOverridden && meter.displayName.value.trim()) {
    return meter.displayName.value.trim();
  }
  const manufacturer = meter.deviceFamily === 'OTHER'
    ? meter.customManufacturerName?.trim()
    : 'Wattwatchers';
  const model = meter.deviceModel === 'OTHER'
    ? meter.customModelName?.trim() || 'metering device'
    : meter.deviceModel;
  return [manufacturer, model].filter(Boolean).join(' ');
}

export function deviceSearchRecords(trees: InstallationTree[]): DeviceSearchRecord[] {
  return trees.flatMap((tree) => meterDevices(tree)
    .filter((meter) => meter.lifecycleState !== 'INACTIVE')
    .flatMap((meter) => {
      const board = tree.electricalAssets.find((item) => item.id === meter.installedOnBoardId);
      if (!board) return [];
      const zone = tree.zones.find((item) => item.id === board.zoneId);
      const deviceName = humanDeviceName(meter);
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
        deviceModel: meter.deviceModel === 'OTHER'
          ? meter.customModelName?.trim() || 'Other device'
          : meter.deviceModel,
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
  const form = createFormSubmission(tree, 'comms-fault', user, record);
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
