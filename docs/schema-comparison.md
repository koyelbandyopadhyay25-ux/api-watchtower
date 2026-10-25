# Comparing observed JSON structures

## Usage

```typescript
import { compareJsonSchema } from '../src/schema-comparison/compare-json-schema.js';

const changes = compareJsonSchema(
  { id: 101, name: 'Alex', email: 'alex@example.com', active: true },
  { id: '101', name: 'Alex', active: true },
);
```

Output, sorted by path:

```json
[
  {
    "path": "$.email",
    "changeType": "removed",
    "previousTypes": ["string"],
    "currentTypes": []
  },
  {
    "path": "$.id",
    "changeType": "type_changed",
    "previousTypes": ["number"],
    "currentTypes": ["string"]
  }
]
```

`SchemaChange` includes a path, a change type (`added`, `removed`, or `type_changed`), and sorted sets of observed previous/current JSON types. Type sets support heterogeneous arrays without arbitrarily choosing one type. An empty type set denotes an absent property, not JSON null. There is no breaking-change flag: consumer compatibility cannot be determined from samples alone.

## Algorithm

1. Walk each parsed JSON response, recording types and object property names. Ignore primitive values.
2. For arrays, accumulate evidence from every element into one item schema. Object properties are merged by name and their observed types are unioned. Nested arrays repeat the same process at each depth.
3. Compare the two recorded structures recursively. Report added/removed fields and changed type sets. Descend through object/array branches only where both samples supply evidence for those branches.
4. Sort changes by path using JavaScript string code-unit order. Type sets and property traversal also use deterministic sorting; no locale-dependent comparisons are used.

`$` identifies the root. Ordinary identifiers use dot notation, such as `$.user.profile.name`. Array items use `[]`, such as `$.products[].price` or `$.matrix[][].score`. Unusual keys use JSON-quoted brackets: `$["a.b"]` denotes a literal key containing a dot. This is a descriptive path format; it is not an executable JSONPath query language.

An added/removed subtree produces one record at its root. Replacing an object with a string similarly produces a single type change, without redundant removals for every old descendant. If heterogeneous items retain an object branch while another item type changes, changes inside that shared object branch are still reported.

## Conservative array policy

- Every element contributes evidence. No index matching, first-element shortcut, majority vote, or universal contract inference is used.
- Reordering, duplicated elements, array length changes, and primitive value changes do not affect the result when the observed structure remains the same.
- `[1, "a", null]` has item types `["null", "number", "string"]`. Replacing it with `[1, false]` reports an observed item type-set change at `$[]`.
- An empty array has unknown item structure. Comparing `[]` with `[{"id": 1}]` reports no item changes in either direction. This is insufficient evidence, not proof that the schemas are identical. The outer `array` type can still change to another JSON type.
- Empty arrays mixed with populated arrays contribute no extra item types. For example, `[[], [1]]` and `[[2]]` have the same observed structure.
- Object fields are the union of fields seen across object elements. `[{"a": 1}, {"b": true}]` and `[{"a": 2, "b": false}]` therefore produce no change. Field frequency and co-occurrence are deliberately not interpreted as schema constraints.
- If a field is seen in any previous object item but in no current object items, it is reported as removed from the observed sample. This does not prove it was removed from the API contract. A previously unseen field is reported symmetrically as added.

## Limitations and input boundary

Two responses cannot establish required versus optional fields. A missing field might reflect a different record, permissions, pagination, sampling, or an actual contract change. Null is an observed JSON type, not evidence of what a non-null value would contain. Objects with null and non-null samples can reveal an object branch; null alone cannot.

Unioning array evidence loses relationships between fields and variants. This engine does not infer discriminated unions, tuple positions, requiredness, counts, formats, enum values, numeric ranges, or business meaning. Different shapes can produce the same observed schema. An empty result means no detectable structural difference under this policy, not guaranteed compatibility. Compare against a separately defined contract when those guarantees are needed.

Inputs must be valid parsed JSON values matching `JsonValue`. This module does not parse text or validate arbitrary JavaScript objects. Undefined, sparse arrays, functions, dates, NaN/Infinity, cyclic graphs, and other non-JSON inputs are outside its contract. Numbers use JSON's single `number` type; integers and decimals are not distinguished. The traversal is recursive and intended for ordinary API payloads; depth/size limits should be enforced at a future ingestion boundary before processing untrusted large responses.

Inputs are never mutated. Inference visits each JSON value once; property/type sorting adds sorting overhead. Storage is proportional to the distinct observed structure, plus output. Very heterogeneous arrays can accumulate many distinct property paths.

## Scope after Phase 2

The engine is callable directly and tested independently of Express. Phase 3A adds a separate [persistence layer](database.md) for endpoints, explicit baselines, checks, and these structured change records. Phase 3B adds [manual local monitoring](monitoring-api.md). Its `inferJsonSchema` and `compareInferredSchemas` adapters serialize/restore the existing observed schema representation and reuse the original traversal, so persisted baselines follow the same union/empty-array policy. Ingestion limits bound response depth/size before inference. There is no automatic baseline selection, scheduler, or alert delivery.
