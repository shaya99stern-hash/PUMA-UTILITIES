/** Helpers for follow-up threading. Pure. */
import { cleanMessageId } from './reply';

export function followUpHeaders(priorMessageIds: string[]): { inReplyTo: string | null; references: string[] } {
  const ids = priorMessageIds.map(cleanMessageId).filter(Boolean) as string[];
  return { inReplyTo: ids[ids.length - 1] ?? null, references: ids };
}
