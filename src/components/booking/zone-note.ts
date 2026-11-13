import { DateTime } from 'luxon';

/** "Europe/Madrid" → "Madrid", "America/New_York" → "New York". */
export function zoneCity(zone: string): string {
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
}

/**
 * The line under the times. They are always shown in the visitor's own time
 * zone; when the business keeps a different clock, say by how much, so a
 * client in London booking someone in Berlin knows which hour they chose.
 */
export function zoneNote(viewerZone: string, businessZone: string | undefined, businessName: string | undefined, at: DateTime = DateTime.now()): string {
  const mine = `Times are in your time zone (${zoneCity(viewerZone)})`;
  if (!businessZone || businessZone === viewerZone) return `${mine}.`;
  const viewer = at.setZone(viewerZone);
  const business = at.setZone(businessZone);
  if (!viewer.isValid || !business.isValid) return `${mine}.`;
  const diff = (viewer.offset - business.offset) / 60;
  if (diff === 0) return `${mine}, the same as ${businessName ?? 'the business'} in ${zoneCity(businessZone)}.`;
  const hours = Math.abs(diff);
  const amount = Number.isInteger(hours) ? `${hours} hour${hours === 1 ? '' : 's'}` : `${hours} hours`;
  return `${mine}: ${amount} ${diff < 0 ? 'behind' : 'ahead of'} ${businessName ?? 'the business'} in ${zoneCity(businessZone)}.`;
}
