import { readFile } from 'node:fs/promises';

const VECTOR_SIZE = 256;

function tokenize(text) {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const compact = normalized.replace(/\s+/g, '');
  const ngrams = [];
  for (let index = 0; index < compact.length - 1; index += 1) ngrams.push(compact.slice(index, index + 2));
  return [...words, ...ngrams];
}

function hash(token) {
  let value = 2166136261;
  for (const char of token) {
    value ^= char.codePointAt(0);
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value) % VECTOR_SIZE;
}

export class LocalHashEmbeddingModel {
  constructor(dimensions = VECTOR_SIZE) {
    this.dimensions = dimensions;
    this.name = `local-hash-${dimensions}`;
  }

  embed(text) {
    const vector = new Float64Array(this.dimensions);
    for (const token of tokenize(text)) vector[hash(token) % this.dimensions] += 1;
    const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
    return Array.from(vector, (item) => item / magnitude);
  }
}

function cosine(left, right) {
  return left.reduce((sum, item, index) => sum + item * right[index], 0);
}

export async function createLocalRetriever(knowledgePath, model = new LocalHashEmbeddingModel()) {
  const documents = JSON.parse(await readFile(knowledgePath, 'utf8'));
  const indexed = documents.map((document) => ({ ...document, vector: model.embed(`${document.title} ${document.tags.join(' ')} ${document.content}`) }));
  return {
    model: model.name,
    size: documents.length,
    search(query, limit = 3) {
      const queryVector = model.embed(query);
      return indexed
        .map(({ vector, ...document }) => ({ ...document, score: Number(cosine(queryVector, vector).toFixed(4)) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },
  };
}
