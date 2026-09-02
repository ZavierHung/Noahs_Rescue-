import { readFile } from 'node:fs/promises';
import path from 'node:path';

function dataFile(dataDirectory, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) throw new Error('god_prompt_file_missing');
  const root = path.resolve(dataDirectory);
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('god_prompt_file_outside_data_backend');
  return resolved;
}

function validateDefinition(god) {
  for (const field of ['id', 'name', 'type', 'values', 'voice', 'promptFile']) {
    if (typeof god?.[field] !== 'string' || !god[field].trim()) throw new Error(`god_definition_invalid:${field}`);
  }
}

export function createGodRepository(dataDirectory) {
  const definitionsPath = path.join(dataDirectory, 'gods.json');

  async function list() {
    const definitions = JSON.parse(await readFile(definitionsPath, 'utf8'));
    if (!Array.isArray(definitions) || definitions.length === 0) throw new Error('god_definitions_empty');
    const ids = new Set();
    return Promise.all(definitions.map(async (definition) => {
      validateDefinition(definition);
      if (ids.has(definition.id)) throw new Error(`god_definition_duplicate:${definition.id}`);
      ids.add(definition.id);
      const prompt = (await readFile(dataFile(dataDirectory, definition.promptFile), 'utf8')).trim();
      if (!prompt) throw new Error(`god_prompt_empty:${definition.id}`);
      return { ...definition, prompt };
    }));
  }

  async function get(id) {
    const god = (await list()).find((item) => item.id === id);
    if (!god) throw new Error(`god_profile_missing:${id}`);
    return god;
  }

  async function describe() {
    const gods = await list();
    return { source: 'data-backend', loaded: gods.length };
  }

  return { list, get, describe };
}
