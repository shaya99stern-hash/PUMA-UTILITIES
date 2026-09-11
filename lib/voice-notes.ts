export type VoicePhase =
  | 'idle'
  | 'requesting'
  | 'recording'
  | 'processing'
  | 'review'
  | 'saved'
  | 'permission-denied'
  | 'unsupported'
  | 'error';

export type VoiceEvent =
  | 'START'
  | 'PERMISSION_GRANTED'
  | 'PERMISSION_DENIED'
  | 'STOP'
  | 'TRANSCRIPT_READY'
  | 'SAVE'
  | 'CANCEL'
  | 'UNSUPPORTED'
  | 'FAIL';

export type VoiceContext = { companyId?: string; propertyId?: string };

export function resolveVoiceDestination(context: VoiceContext) {
  if (context.propertyId) return 'property' as const;
  if (context.companyId) return 'company' as const;
  return 'inbox' as const;
}

export function nextVoicePhase(current: VoicePhase, event: VoiceEvent): VoicePhase {
  if (event === 'PERMISSION_DENIED') return 'permission-denied';
  if (event === 'UNSUPPORTED') return 'unsupported';
  if (event === 'FAIL') return 'error';
  if (event === 'CANCEL') return 'idle';
  if (current === 'idle' && event === 'START') return 'requesting';
  if (current === 'requesting' && event === 'PERMISSION_GRANTED') return 'recording';
  if (current === 'recording' && event === 'STOP') return 'processing';
  if (current === 'processing' && event === 'TRANSCRIPT_READY') return 'review';
  if (current === 'review' && event === 'SAVE') return 'saved';
  return current;
}
