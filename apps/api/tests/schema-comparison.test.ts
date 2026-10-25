import { describe, expect, it } from 'vitest';
import { compareJsonSchema } from '../src/schema-comparison/compare-json-schema.js';
import type { JsonValue, SchemaChange } from '../src/schema-comparison/schema-types.js';

function change(
  path: string,
  changeType: SchemaChange['changeType'],
  previousTypes: SchemaChange['previousTypes'],
  currentTypes: SchemaChange['currentTypes'],
): SchemaChange {
  return { path, changeType, previousTypes, currentTypes };
}

describe('compareJsonSchema', () => {
  it('reports the requested example in deterministic path order', () => {
    expect(compareJsonSchema(
      { id: 101, name: 'Alex', email: 'alex@example.com', active: true },
      { id: '101', name: 'Alex', active: true },
    )).toEqual([
      change('$.email', 'removed', ['string'], []),
      change('$.id', 'type_changed', ['number'], ['string']),
    ]);
  });

  it('ignores primitive values and property ordering', () => {
    expect(compareJsonSchema(
      { amount: 100, name: 'Alex', active: true, absent: null },
      { absent: null, active: false, name: 'Sam', amount: 200 },
    )).toEqual([]);
  });

  it('detects nested additions, removals, and type changes', () => {
    expect(compareJsonSchema(
      { user: { profile: { name: 'Alex', age: 20 } } },
      { user: { profile: { name: null, email: 'a@example.com' } } },
    )).toEqual([
      change('$.user.profile.age', 'removed', ['number'], []),
      change('$.user.profile.email', 'added', [], ['string']),
      change('$.user.profile.name', 'type_changed', ['string'], ['null']),
    ]);
  });

  it('reports an added or removed subtree only at its root', () => {
    expect(compareJsonSchema({ old: { x: 1 } }, { new: { y: true } })).toEqual([
      change('$.new', 'added', [], ['object']),
      change('$.old', 'removed', ['object'], []),
    ]);
  });

  it.each([
    [1, '1', 'number', 'string'],
    [null, false, 'null', 'boolean'],
    [{ a: 1 }, [], 'object', 'array'],
    [[1], null, 'array', 'null'],
    [true, {}, 'boolean', 'object'],
  ] as const)('supports root type transitions from %j to %j', (before, after, from, to) => {
    expect(compareJsonSchema(before as JsonValue, after as JsonValue)).toEqual([
      change('$', 'type_changed', [from], [to]),
    ]);
  });

  it('compares object fields inside arrays', () => {
    expect(compareJsonSchema(
      { products: [{ price: 10, label: 'A' }, { price: 20, label: 'B' }] },
      { products: [{ price: '10', stock: 2 }] },
    )).toEqual([
      change('$.products[].label', 'removed', ['string'], []),
      change('$.products[].price', 'type_changed', ['number'], ['string']),
      change('$.products[].stock', 'added', [], ['number']),
    ]);
  });

  it('ignores array ordering, duplicate elements, and optional-field frequency', () => {
    expect(compareJsonSchema(
      [{ a: 1 }, { b: true }, null, 'x', [1]],
      [[2, 3], 'y', null, { b: false, a: 2 }, { a: 3 }],
    )).toEqual([]);
  });

  it('reports sorted heterogeneous item type sets', () => {
    expect(compareJsonSchema([1, 'a', null], [false, 2])).toEqual([
      change('$[]', 'type_changed', ['null', 'number', 'string'], ['boolean', 'number']),
    ]);
  });

  it('compares shared object branches even when item type sets differ', () => {
    expect(compareJsonSchema([null, { id: 1 }], [{ id: '1' }])).toEqual([
      change('$[]', 'type_changed', ['null', 'object'], ['object']),
      change('$[].id', 'type_changed', ['number'], ['string']),
    ]);
  });

  it.each([
    [[], []], [[], [{ id: 1 }]], [[{ id: 1 }], []],
    [[[]], [[{ id: 1 }]]], [[[], [1]], [[2]]],
  ])('treats empty array item structure as unknown: %j versus %j', (before, after) => {
    expect(compareJsonSchema(before as JsonValue, after as JsonValue)).toEqual([]);
  });

  it('compares nested arrays at each observed depth', () => {
    expect(compareJsonSchema(
      { matrix: [[{ score: 1 }], []] },
      { matrix: [[{ score: false }]] },
    )).toEqual([change('$.matrix[][].score', 'type_changed', ['number'], ['boolean'])]);
  });

  it('distinguishes null from missing and from an object', () => {
    expect(compareJsonSchema({ a: null, b: null }, { b: {} })).toEqual([
      change('$.a', 'removed', ['null'], []),
      change('$.b', 'type_changed', ['null'], ['object']),
    ]);
  });

  it('quotes ambiguous, empty, numeric, and escaped property names', () => {
    expect(compareJsonSchema({}, JSON.parse('{"a.b":1,"":null,"0":true,"x\\\"y":[],"__proto__":{}}')))
      .toEqual([
        change('$.__proto__', 'added', [], ['object']),
        change('$[""]', 'added', [], ['null']),
        change('$["0"]', 'added', [], ['boolean']),
        change('$["a.b"]', 'added', [], ['number']),
        change('$["x\\"y"]', 'added', [], ['array']),
      ]);
  });

  it('is repeatable and leaves frozen inputs unchanged', () => {
    const before = Object.freeze({ items: Object.freeze({ id: 1 }) });
    const after = Object.freeze({ items: Object.freeze({ id: '1' }) });
    const expected = [change('$.items.id', 'type_changed', ['number'], ['string'])];
    expect(compareJsonSchema(before, after)).toEqual(expected);
    expect(compareJsonSchema(before, after)).toEqual(expected);
  });
});
