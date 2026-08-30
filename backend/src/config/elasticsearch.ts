import { Client } from '@elastic/elasticsearch';
import { env } from './env';

let esClient: Client | null = null;

try {
  esClient = new Client({
    node: env.ELASTICSEARCH_URL,
    maxRetries: 3,
    requestTimeout: 5000,
  });

  // Verify connection asynchronously without blocking server start
  esClient.ping()
    .then(() => console.log('✔ Connected to Elasticsearch'))
    .catch((err) => {
      console.warn('⚠️ Elasticsearch connection failed. Search indexing may be unavailable:', err.message);
    });
} catch (err: any) {
  console.error('❌ Failed to initialize Elasticsearch client:', err.message);
}

export default esClient;
