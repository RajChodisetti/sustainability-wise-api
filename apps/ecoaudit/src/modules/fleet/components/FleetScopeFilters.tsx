import { Select } from '@/components/ui/FormFields';
import type { FleetClient } from '@/modules/fleet/types/domain';

export function FleetScopeFilters({
  clients,
  clientId,
  maas,
  onClientChange,
  onMaasChange,
  className = '',
}: {
  clients: FleetClient[];
  clientId: string;
  maas: '' | 'true' | 'false';
  onClientChange: (value: string) => void;
  onMaasChange: (value: '' | 'true' | 'false') => void;
  className?: string;
}) {
  return (
    <fieldset
      className={`grid gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-2 ${className}`}
    >
      <legend className="sr-only">Fleet scope filters</legend>
      <label className="block text-xs font-bold uppercase tracking-[0.07em] text-[var(--text-sub)]">
        Fleet account
        <Select
          className="mt-1.5 normal-case tracking-normal"
          value={clientId}
          onChange={(event) => onClientChange(event.target.value)}
        >
          <option value="">All Fleet accounts</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}{client.isMaas ? ' · MaaS' : ''}
            </option>
          ))}
        </Select>
      </label>
      <label className="block text-xs font-bold uppercase tracking-[0.07em] text-[var(--text-sub)]">
        MaaS classification
        <Select
          className="mt-1.5 normal-case tracking-normal"
          value={maas}
          onChange={(event) => onMaasChange(event.target.value as '' | 'true' | 'false')}
        >
          <option value="">All devices</option>
          <option value="true">MaaS only</option>
          <option value="false">Non-MaaS only</option>
        </Select>
      </label>
    </fieldset>
  );
}
