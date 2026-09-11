import test from 'node:test';
import assert from 'node:assert/strict';
import { nextVoicePhase, resolveVoiceDestination } from '../lib/voice-notes';

test('property context wins over company context', () => {
  assert.equal(resolveVoiceDestination({ companyId: 'c1', propertyId: 'p1' }), 'property');
});

test('company context saves to company when no property is selected', () => {
  assert.equal(resolveVoiceDestination({ companyId: 'c1' }), 'company');
});

test('no record context routes to voice inbox', () => {
  assert.equal(resolveVoiceDestination({}), 'inbox');
});

test('voice phase follows permission -> recording -> processing -> review -> saved', () => {
  let phase = nextVoicePhase('idle', 'START');
  assert.equal(phase, 'requesting');
  phase = nextVoicePhase(phase, 'PERMISSION_GRANTED');
  assert.equal(phase, 'recording');
  phase = nextVoicePhase(phase, 'STOP');
  assert.equal(phase, 'processing');
  phase = nextVoicePhase(phase, 'TRANSCRIPT_READY');
  assert.equal(phase, 'review');
  phase = nextVoicePhase(phase, 'SAVE');
  assert.equal(phase, 'saved');
});

test('permission denial is explicit', () => {
  assert.equal(nextVoicePhase('requesting', 'PERMISSION_DENIED'), 'permission-denied');
});
