import { ObjectStorageError } from './object-storage.error';

/** The Bot Application Layer's upload never completed, or the referenced object expired/was deleted before the worker processed the job. */
export class ObjectNotFoundError extends ObjectStorageError {
  constructor(uri: string) {
    super(`Object not found in storage: "${uri}".`);
  }
}
