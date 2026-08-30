export type InstallHubInventoryMeterModel = 'A3RM' | 'A6M' | 'OTHER';
export type InstallHubInventoryMeterStatus = 'company' | 'user' | 'installed';

export type InstallHubInventoryMeter = {
  id: string;
  deviceId: string;
  deviceModel: InstallHubInventoryMeterModel;
  customManufacturerName: string | null;
  customModelName: string | null;
  status: InstallHubInventoryMeterStatus;
  custodianUserId: string | null;
  custodianName?: string | null;
  installedInstallationId: string | null;
  installedMeterId: string | null;
  businessClientId: string | null;
  businessSiteId: string | null;
  businessJobId: string | null;
  notes: string | null;
  revision: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type InstallHubInventoryAccess = {
  userId: string;
  isMaintainer: boolean;
};

export type InstallHubInventoryResponse = {
  data: InstallHubInventoryMeter[];
  total: number;
  truncated: boolean;
};
