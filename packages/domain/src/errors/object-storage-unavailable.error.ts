import { ObjectStorageError } from './object-storage.error';

export class ObjectStorageUnavailableError extends ObjectStorageError {
  constructor() {
    super('Object storage is temporarily unavailable.');
  }
}
