import assert from 'node:assert/strict';
import test from 'node:test';
import { parseContactOutStaff } from './parser.mjs';

test('parses visible ContactOut staff names and roles without contact reveals', () => {
  const text = `
Denholtz Properties Staff Directory
Image: Stephen Cassidy SC
Stephen Cassidy
President
View
(••) ••• ••• •••
******@denholtz.com
Steven Denholtz
Chief Executive Officer
View
(••) ••• ••• •••
******@denholtz.com
Paul Paschal
Director of Acquisitions
View
`;
  const people = parseContactOutStaff(text, 'https://contactout.com/company/Denholtz-Properties-31352', 10);
  assert.deepEqual(people.map((person) => [person.name, person.title]), [
    ['Stephen Cassidy', 'President'],
    ['Steven Denholtz', 'Chief Executive Officer'],
    ['Paul Paschal', 'Director of Acquisitions'],
  ]);
  assert.ok(people.every((person) => person.visibility === 'public'));
  assert.equal(JSON.stringify(people).includes('******@'), false);
});
