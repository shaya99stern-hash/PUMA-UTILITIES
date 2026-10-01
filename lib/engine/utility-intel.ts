/**
 * What we know about each water utility's metering technology. Utility-wide programs tell us
 * whether a building's meters are likely smart (AMI / AMR) or manually read; building-level
 * meter status is only "confirmed" when a client shares it. Sources are public utility pages.
 */
export type MeterProgram = {
  status: 'ami' | 'amr' | 'ami_rollout' | 'manual' | 'unknown';
  label: string;
  detail: string;
  source: string | null;
};

type Entry = { match: RegExp; program: MeterProgram };

const PROGRAMS: Entry[] = [
  {
    match: /new york city|nyc|nycdep|ny7003493/i,
    program: {
      status: 'amr',
      label: 'Automated meter reading (citywide)',
      detail: 'NYC DEP reads ~830,000 meters automatically; owners can see daily/hourly usage in My DEP Account. Building-level sub-metering and leak monitoring are still owner-side.',
      source: 'https://www.nyc.gov/site/dep/pay-my-bills/automated-meter-reading.page',
    },
  },
  {
    match: /philadelphia/i,
    program: {
      status: 'ami_rollout',
      label: 'AMI rollout in progress',
      detail: 'Philadelphia Water Department is replacing meters with advanced metering infrastructure; many buildings are still on legacy reads.',
      source: 'https://water.phila.gov/projects/ami/',
    },
  },
  {
    match: /new jersey american|nj american|njaw/i,
    program: {
      status: 'ami_rollout',
      label: 'AMI upgrades underway',
      detail: 'New Jersey American Water is upgrading service areas to advanced (smart) meters; coverage varies by town.',
      source: 'https://www.amwater.com/njaw/',
    },
  },
  {
    match: /pennsylvania american|pa american/i,
    program: {
      status: 'ami_rollout',
      label: 'AMI upgrades underway',
      detail: 'Pennsylvania American Water is deploying advanced meters across its service areas; coverage varies.',
      source: 'https://www.amwater.com/paaw/',
    },
  },
];

export function meterProgramFor(utilityName: string | null | undefined, pwsid?: string | null): MeterProgram {
  const hay = `${utilityName ?? ''} ${pwsid ?? ''}`;
  const hit = PROGRAMS.find((p) => p.match.test(hay));
  if (hit) return hit.program;
  return {
    status: 'unknown',
    label: 'Metering not confirmed',
    detail: utilityName ? `No public smart-meter program found for ${utilityName}; assume manual or drive-by reads until confirmed.` : 'Utility not resolved yet.',
    source: null,
  };
}

/** Puma's pitch angle given the utility's metering. */
export function meteringAngle(p: MeterProgram): string {
  switch (p.status) {
    case 'ami':
    case 'amr':
      return 'Utility data is available but only at the master meter: Puma adds building/riser sub-metering and real-time leak alerts.';
    case 'ami_rollout':
      return 'Utility is mid-rollout of smart meters: Puma gives real-time visibility now, independent of the utility schedule.';
    case 'manual':
      return 'Manually read meters: leaks can run a full billing cycle unnoticed — strongest fit for Puma monitoring.';
    default:
      return 'Metering unknown: confirm on a site visit; Puma monitoring works with any meter.';
  }
}
