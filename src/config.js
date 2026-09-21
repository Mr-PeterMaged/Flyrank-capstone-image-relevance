import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function config(env = process.env) {
  const thresholds=JSON.parse(readFileSync(path.join(root,'evals','thresholds.json'),'utf8'));
  const number = (key, fallback, min = 0, max = 1e9) => {
    const n = Number(env[key] ?? fallback);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid ${key}`);
    return n;
  };
  return {
    port: number('PORT', 3200, 1, 65535), host: env.HOST || '127.0.0.1',
    databaseUrl: env.DATABASE_URL || 'postgres://postgres:local-capstone-only@127.0.0.1:5434/image_relevance',
    dataDir: path.resolve(env.DATA_DIR || path.join(root, 'data')),
    ollamaUrl: env.OLLAMA_URL || 'http://127.0.0.1:11435',
    visionModel: env.VISION_MODEL || 'qwen3-vl:2b', embeddingModel: env.EMBEDDING_MODEL || 'all-minilm',
    modelTimeoutMs: number('MODEL_TIMEOUT_MS', 300000, 100, 600000),
    workerPollMs: number('WORKER_POLL_MS', 1000, 50, 10000),
    maxAttempts: number('JOB_MAX_ATTEMPTS', 3, 1, 5), retryMs: number('JOB_RETRY_MS', 2000, 1, 60000),
    dailyCalls: number('DAILY_CALL_LIMIT', 250, 0, 10000), dailyUsd: number('DAILY_USD_LIMIT', 0, 0, 100),
    similarity: number('SIMILARITY_THRESHOLD', thresholds.similarity, 0, 1), confidence: number('CONFIDENCE_THRESHOLD', thresholds.confidence, 0, 1),
    workerEnabled: env.WORKER_ENABLED !== 'false',
  };
}
