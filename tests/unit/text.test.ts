import { test } from 'node:test';
import assert from 'node:assert';
import {
  companyNameKey,
  normalizeDomain,
  normalizePhone,
  normalizeEmail,
  splitName,
  addressKey,
  titleCase,
} from '@/lib/text';

test('companyNameKey dedupes company names', () => {
  assert.strictEqual(companyNameKey('The Kushner Companies, LLC'), 'kushner companies');
  assert.strictEqual(companyNameKey('Kushner Companies'), 'kushner companies');
  assert.strictEqual(companyNameKey('KUSHNER COMPANIES'), 'kushner companies');
  assert.strictEqual(
    companyNameKey('The Kushner Companies, L.L.C.'),
    'kushner companies'
  );
});

test('companyNameKey handles edge cases', () => {
  assert.strictEqual(companyNameKey('123 Corp Inc Ltd'), '123');
  assert.strictEqual(companyNameKey('A & B Holdings'), 'a and b holdings');
  assert.strictEqual(companyNameKey('Café du Jour'), 'cafe du jour');
});

test('normalizeDomain extracts domain from various formats', () => {
  assert.strictEqual(normalizeDomain('https://www.example.com'), 'example.com');
  assert.strictEqual(normalizeDomain('http://example.com/path'), 'example.com');
  assert.strictEqual(normalizeDomain('www.example.com'), 'example.com');
  assert.strictEqual(normalizeDomain('example.com'), 'example.com');
  assert.strictEqual(normalizeDomain('user@example.com'), 'example.com');
  assert.strictEqual(normalizeDomain('https://example.com?query=1'), 'example.com');
});

test('normalizeDomain returns null for invalid input', () => {
  assert.strictEqual(normalizeDomain(null), null);
  assert.strictEqual(normalizeDomain(''), null);
  assert.strictEqual(normalizeDomain('   '), null);
  assert.strictEqual(normalizeDomain('invalid'), null);
  assert.strictEqual(normalizeDomain('@invalid.com'), null);
});

test('normalizePhone formats valid numbers', () => {
  assert.strictEqual(normalizePhone('2125551234'), '(212) 555-1234');
  assert.strictEqual(normalizePhone('12125551234'), '(212) 555-1234');
  assert.strictEqual(normalizePhone('(212) 555-1234'), '(212) 555-1234');
  assert.strictEqual(normalizePhone('212-555-1234'), '(212) 555-1234');
});

test('normalizePhone returns null for invalid input', () => {
  assert.strictEqual(normalizePhone(null), null);
  assert.strictEqual(normalizePhone(''), null);
  assert.strictEqual(normalizePhone('123'), null);
  assert.strictEqual(normalizePhone('abc'), null);
});

test('normalizePhone preserves non-standard input', () => {
  assert.strictEqual(normalizePhone('ext. 123'), 'ext. 123');
});

test('normalizeEmail validates and lowercases', () => {
  assert.strictEqual(normalizeEmail('Test@Example.Com'), 'test@example.com');
  assert.strictEqual(normalizeEmail('user+tag@example.co.uk'), 'user+tag@example.co.uk');
  assert.strictEqual(normalizeEmail('   test@example.com   '), 'test@example.com');
});

test('normalizeEmail returns null for invalid input', () => {
  assert.strictEqual(normalizeEmail(null), null);
  assert.strictEqual(normalizeEmail(''), null);
  assert.strictEqual(normalizeEmail('notanemail'), null);
  assert.strictEqual(normalizeEmail('user@'), null);
  assert.strictEqual(normalizeEmail('@example.com'), null);
  assert.strictEqual(normalizeEmail('user name@example.com'), null);
});

test('splitName handles single and multiple names', () => {
  assert.deepStrictEqual(splitName('John Doe'), { first: 'John', last: 'Doe' });
  assert.deepStrictEqual(splitName('Jane'), { first: 'Jane', last: null });
  assert.deepStrictEqual(splitName('John Q Public'), {
    first: 'John',
    last: 'Q Public',
  });
  assert.deepStrictEqual(splitName('María José García'), {
    first: 'María',
    last: 'José García',
  });
});

test('splitName handles whitespace', () => {
  assert.deepStrictEqual(splitName('  John   Doe  '), { first: 'John', last: 'Doe' });
});

test('addressKey normalizes addresses for cross-reference', () => {
  assert.strictEqual(
    addressKey('Suite 400, 210 Hudson Street'),
    '210 HUDSON ST'
  );
  assert.strictEqual(
    addressKey('210 HUDSON ST STE 400'),
    '210 HUDSON ST'
  );
  assert.strictEqual(
    addressKey('123 Main Ave, Unit 4B, Floor 2'),
    '123 MAIN AVE'
  );
  assert.strictEqual(
    addressKey('456 Oak Boulevard #100'),
    '456 OAK BLVD'
  );
});

test('addressKey strips direction abbreviations', () => {
  assert.strictEqual(
    addressKey('123 West Main Street'),
    '123 W MAIN ST'
  );
  assert.strictEqual(
    addressKey('456 North Park Avenue'),
    '456 N PARK AVE'
  );
});

test('addressKey handles punctuation', () => {
  assert.strictEqual(addressKey('123 Main St., Apt. 5'), '123 MAIN ST');
  assert.strictEqual(addressKey('456, Oak Dr., #10'), '456 OAK DR');
});

test('titleCase capitalizes words correctly', () => {
  assert.strictEqual(titleCase('john doe'), 'John Doe');
  assert.strictEqual(titleCase('JOHN DOE'), 'John Doe');
  assert.strictEqual(titleCase('john q public'), 'John Q Public');
});

test('titleCase handles special acronyms', () => {
  assert.strictEqual(titleCase('acme llc'), 'Acme LLC');
  assert.strictEqual(titleCase('new york city'), 'New York City');
  assert.strictEqual(titleCase('mcdonalds inc'), 'McDonalds Inc');
  assert.strictEqual(titleCase('hoa rules'), 'HOA Rules');
  assert.strictEqual(titleCase('nj property'), 'NJ Property');
  assert.strictEqual(titleCase('usa inc'), 'USA Inc');
  assert.strictEqual(titleCase('name the ii'), 'Name The II');
  assert.strictEqual(titleCase('name iii'), 'Name III');
  assert.strictEqual(titleCase('name iv'), 'Name IV');
});
