import type { Company, MonitorAlert, Workspace } from './types';

function clientProperties(company: Company, workspace: Workspace) {
  return workspace.properties.filter((property) => property.companyId === company.id);
}

/** Only client-authorized readings may enter the monitoring surface. */
export function buildMonitorAlerts(workspace: Workspace): MonitorAlert[] {
  const alerts: MonitorAlert[] = [];
  const utilitiesById = new Map(workspace.utilities.map((utility) => [utility.id, utility]));
  const propertiesById = new Map(workspace.properties.map((property) => [property.id, property]));

  workspace.companies
    .filter((company) => company.stage === 'Client')
    .forEach((company) => {
      const propertyIds = new Set(clientProperties(company, workspace).map((property) => property.id));
      workspace.meters.forEach((meter) => {
        const utility = utilitiesById.get(meter.utilityServiceId);
        if (!utility || !propertyIds.has(utility.propertyId)) return;
        const property = propertiesById.get(utility.propertyId);
        if (!property) return;

        meter.readings
          .filter((reading) => reading.status === 'client-authorized')
          .forEach((reading) => {
            const base = {
              companyId: company.id,
              propertyId: property.id,
              meterId: meter.id,
              periodEnd: reading.periodEnd,
              status: 'client-authorized' as const,
              provenanceId: reading.provenanceId,
            };

            if (reading.continuousFlow) {
              alerts.push({
                ...base,
                id: `${meter.id}:${reading.id}:continuous-flow`,
                kind: 'Continuous flow',
                title: `${property.name}: continuous-flow signal`,
                detail: `The authorized reading for ${meter.label} was marked as continuous flow.`,
              });
            }

            if (
              workspace.monitorSettings.spendThreshold !== undefined
              && reading.cost !== undefined
              && reading.cost > workspace.monitorSettings.spendThreshold
            ) {
              alerts.push({
                ...base,
                id: `${meter.id}:${reading.id}:spend`,
                kind: 'Spend threshold',
                title: `${property.name}: spend above threshold`,
                detail: `$${reading.cost.toLocaleString()} exceeds the configured $${workspace.monitorSettings.spendThreshold.toLocaleString()} threshold for this reading period.`,
              });
            }

            if (
              workspace.monitorSettings.varianceThresholdPercent !== undefined
              && reading.gallons !== undefined
              && reading.expectedGallons !== undefined
              && reading.expectedGallons > 0
            ) {
              const variance = ((reading.gallons - reading.expectedGallons) / reading.expectedGallons) * 100;
              if (variance > workspace.monitorSettings.varianceThresholdPercent) {
                alerts.push({
                  ...base,
                  id: `${meter.id}:${reading.id}:unexpected-use`,
                  kind: 'Unexpected use',
                  title: `${property.name}: use above expected baseline`,
                  detail: `${Math.round(variance)}% above the stated expected use, exceeding the configured ${workspace.monitorSettings.varianceThresholdPercent}% threshold.`,
                });
              }
            }
          });
      });
    });

  return alerts.sort((a, b) => (b.periodEnd ?? '').localeCompare(a.periodEnd ?? ''));
}
