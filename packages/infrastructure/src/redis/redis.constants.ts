import type Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

// Re-exported so consumers (e.g. apps/api's health check) depend only on
// @afa/infrastructure's public surface, never on ioredis directly.
export type RedisClient = Redis;
