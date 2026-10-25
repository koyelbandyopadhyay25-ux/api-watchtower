import { compareJsonSchema } from './compare-json-schema.js';

const previous = { id: 101, name: 'Alex', email: 'alex@example.com', active: true };
const current = { id: '101', name: 'Alex', active: true };

console.log(JSON.stringify(compareJsonSchema(previous, current), null, 2));
