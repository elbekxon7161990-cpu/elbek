import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

/**
 * One OpenTelemetry SDK factory shared by all three bootstrap apps, each
 * instantiating it with their own service name. Must be started before any
 * other module is imported in a given app's entry file — Node's CommonJS
 * `require` is synchronous, so as long as the app's tracing.ts is the first
 * import in main.ts, auto-instrumentation patches express/Prisma/ioredis
 * before those modules are themselves required anywhere else in the process.
 */
export function createTracingSdk(serviceName: string): NodeSDK {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  return new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? serviceName,
    traceExporter: endpoint ? new OTLPTraceExporter({ url: endpoint }) : undefined,
    instrumentations: [getNodeAutoInstrumentations()],
  });
}
