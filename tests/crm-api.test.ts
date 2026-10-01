import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeCsvField, parseCsv, parseCsvObjects, toCsv, detectDelimiter } from '../lib/crm/csv';
import { mapHeaders, mapImportRows, parseStage, parseTags } from '../lib/crm/import-map';
import { dailyRate, detectReadingAlerts } from '../lib/crm/alerts';
import { fmtMoney, relTime, initials } from '../lib/crm/format';

test('csv escaping quotes, commas, newlines and formula injection', () => {
  assert.equal(escapeCsvField('plain'), 'plain');
  assert.equal(escapeCsvField('a,b'), '"a,b"');
  assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvField('line1\nline2'), '"line1\nline2"');
  assert.equal(escapeCsvField(null), '');
  assert.equal(escapeCsvField(['a', 'b']), 'a; b');
  assert.equal(escapeCsvField('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(escapeCsvField('+12015551234'), '+12015551234');
  assert.equal(escapeCsvField(-5), '-5');
  assert.equal(toCsv(['A', 'B'], [[1, 'x,y']]), 'A,B\r\n1,"x,y"\r\n');
});

test('csv parsing handles quotes, CRLF, BOM, embedded newlines and delimiters', () => {
  const rows = parseCsv('﻿Name,Note\r\n"Smith, J","He said ""ok""\nsecond line"\r\nLee,plain\r\n');
  assert.deepEqual(rows, [['Name', 'Note'], ['Smith, J', 'He said "ok"\nsecond line'], ['Lee', 'plain']]);
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('a;b;c'), ';');
  assert.equal(detectDelimiter('"a,b",c'), ',');
  assert.deepEqual(parseCsvObjects('a;b\n1;2\n\n3;4'), [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
  // Round trip
  const csv = toCsv(['x', 'y'], [['a,"b"', 'multi\nline']]);
  assert.deepEqual(parseCsv(csv), [['x', 'y'], ['a,"b"', 'multi\nline']]);
});

test('import header mapping is flexible and does not let contact email steal company email', () => {
  const map = mapHeaders(['Company Name', 'Website URL', 'Email', 'Contact Email', 'Job Title', '# Units', 'ZIP Code', 'Mystery']);
  assert.equal(map['Company Name'], 'company');
  assert.equal(map['Email'], 'email');
  assert.equal(map['Contact Email'], 'contact_email');
  assert.equal(map['Job Title'], 'title');
  assert.equal(map['ZIP Code'], 'zip');
  assert.equal(map['Mystery'], undefined);
});

test('import rows normalize companies, contacts, stage, tags and skip blanks', () => {
  const { rows, skipped } = mapImportRows([
    { company: 'Kushner Cos', website: 'www.kushner.com/about', phone: '2015551000', 'contact name': 'Jared Kushner', title: 'Owner', 'contact email': 'JK@kushner.com', state: 'nj', units: '5,200', stage: 'Qualified', tags: 'big; nj|hot' },
    { website: 'bozzuto.com' },
    { phone: '555' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(skipped.length, 1);
  assert.equal(rows[0].domain, 'kushner.com');
  assert.equal(rows[0].phone, '(201) 555-1000');
  assert.equal(rows[0].state, 'NJ');
  assert.equal(rows[0].units, 5200);
  assert.equal(rows[0].stage, 'qualified');
  assert.deepEqual(rows[0].tags, ['big', 'nj', 'hot']);
  assert.equal(rows[0].contact?.email, 'jk@kushner.com');
  assert.equal(rows[0].contact?.first_name, 'Jared');
  assert.equal(rows[0].contact?.last_name, 'Kushner');
  assert.equal(rows[1].company, 'Bozzuto');
});

test('stage and tag parsing', () => {
  assert.equal(parseStage('New lead'), 'new');
  assert.equal(parseStage('customer'), 'client');
  assert.equal(parseStage('Closed lost'), 'lost');
  assert.equal(parseStage(''), 'new');
  assert.deepEqual(parseTags('a, b ;a'), ['a', 'b']);
});

test('alert detection: continuous flow', () => {
  const alerts = detectReadingAlerts(
    { periodStart: '2026-09-01', periodEnd: '2026-09-30', gallons: 100000, cost: 500, flags: { min_night_gph: 12 } },
    [],
    { label: 'Main', propertyName: 'Elm Court' },
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'continuous_flow');
  assert.equal(alerts[0].severity, 'critical');
  assert.equal(detectReadingAlerts({ periodStart: null, periodEnd: '2026-09-30', gallons: 1, cost: null, flags: { min_night_gph: 0 } }, [], { label: 'x' }).length, 0);
});

test('alert detection: spike versus trailing average', () => {
  const day = 86_400_000;
  const end = new Date('2026-06-30').getTime();
  const history = [1, 2, 3].map((i) => ({ periodEnd: new Date(end - i * 30 * day), periodStart: new Date(end - (i + 1) * 30 * day), gallons: 30_000 }));
  const base = { periodStart: new Date(end - 30 * day), periodEnd: new Date(end), cost: null };
  assert.equal(detectReadingAlerts({ ...base, gallons: 32_000 }, history, { label: 'm' }).length, 0);
  const warn = detectReadingAlerts({ ...base, gallons: 50_000 }, history, { label: 'm' });
  assert.equal(warn[0].kind, 'spike');
  assert.equal(warn[0].severity, 'warning');
  const crit = detectReadingAlerts({ ...base, gallons: 90_000 }, history, { label: 'm' });
  assert.equal(crit[0].severity, 'critical');
  // Not enough history -> no spike
  assert.equal(detectReadingAlerts({ ...base, gallons: 90_000 }, history.slice(0, 1), { label: 'm' }).length, 0);
  // Spend threshold
  const spend = detectReadingAlerts({ ...base, gallons: 30_000, cost: 9000 }, history, { label: 'm', spendThreshold: 5000 });
  assert.equal(spend[0].kind, 'spend_threshold');
});

test('daily rate ignores unknown periods', () => {
  assert.equal(dailyRate({ periodStart: null, periodEnd: '2026-01-01', gallons: 100 }), null);
  assert.equal(dailyRate({ periodStart: '2026-01-01', periodEnd: '2026-01-11', gallons: 1000 }), 100);
});

test('format helpers', () => {
  assert.equal(fmtMoney(1_250_000, { compact: true }), '$1.3M');
  assert.equal(fmtMoney(45_000, { compact: true }), '$45K');
  assert.equal(fmtMoney(null), '—');
  assert.equal(relTime(new Date(Date.now() - 3 * 86_400_000).toISOString()), '3d ago');
  assert.equal(initials('Jane Q Doe'), 'JD');
});
