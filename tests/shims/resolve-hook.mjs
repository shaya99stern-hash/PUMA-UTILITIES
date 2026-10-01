import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const shimPath = path.resolve(__dirname, 'server-only.mjs');
const shimFileUrl = new URL(`file://${shimPath}`).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') {
    return {
      shortCircuit: true,
      url: shimFileUrl,
    };
  }
  return nextResolve(specifier, context);
}
