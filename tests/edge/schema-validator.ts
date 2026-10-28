import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from '../../apps/platform/node_modules/ajv/dist/2020.js';
import formats from '../../apps/platform/node_modules/ajv-formats/dist/index.js';

const candidates = [
  resolve('contracts/devices/v1/device-ingestion.schema.json'),
  resolve('../../contracts/devices/v1/device-ingestion.schema.json'),
];

let schemaPath = candidates[0];
for (const p of candidates) {
  if (existsSync(p)) {
    schemaPath = p;
    break;
  }
}

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
formats(ajv);
ajv.addSchema(schema);

export const validateMeasurement = ajv.compile({ $ref: schema.$id + '#/$defs/Measurement' });
export const validateMeasurementBatch = ajv.compile({ $ref: schema.$id + '#/$defs/MeasurementBatch' });
