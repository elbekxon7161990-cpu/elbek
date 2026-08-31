// Must be the first import in main.ts — see @afa/shared's
// create-tracing-sdk.ts for why import order matters here.
import { createTracingSdk } from '@afa/shared';

const sdk = createTracingSdk('afa-worker');
sdk.start();

process.on('SIGTERM', () => {
  void sdk.shutdown();
});
