import esClient from '../config/elasticsearch';
import { logger } from '../utils/logger';

const INDEX_NAME = 'emails';

export async function createIndexIfNotExists() {
  if (!esClient) return;
  try {
    const exists = await esClient.indices.exists({ index: INDEX_NAME });
    if (!exists) {
      await esClient.indices.create({
        index: INDEX_NAME,
        mappings: {
          properties: {
            id: { type: 'keyword' },
            campaignId: { type: 'keyword' },
            senderId: { type: 'keyword' },
            userId: { type: 'keyword' },
            recipient: { type: 'text', fields: { keyword: { type: 'keyword' } } },
            subject: { type: 'text' },
            body: { type: 'text' },
            status: { type: 'keyword' },
            scheduledAt: { type: 'date' },
            sentAt: { type: 'date' },
            errorMessage: { type: 'text' },
            previewUrl: { type: 'keyword' },
          },
        },
      });
      logger.info(`Elasticsearch index '${INDEX_NAME}' created`);
    }
  } catch (err: any) {
    logger.warn('Failed to ensure Elasticsearch index exists:', { error: err.message });
  }
}

export async function indexEmailJob(emailJob: any) {
  if (!esClient) return;
  try {
    await esClient.index({
      index: INDEX_NAME,
      id: emailJob.id,
      document: {
        id: emailJob.id,
        campaignId: emailJob.campaignId,
        senderId: emailJob.campaign.senderId,
        userId: emailJob.campaign.userId,
        recipient: emailJob.recipient,
        subject: emailJob.subject,
        body: emailJob.body,
        status: emailJob.status,
        scheduledAt: emailJob.scheduledAt,
        sentAt: emailJob.sentAt,
        errorMessage: emailJob.errorMessage,
        previewUrl: emailJob.previewUrl,
      },
      refresh: true,
    });
    logger.info(`Email job ${emailJob.id} indexed in Elasticsearch`);
  } catch (err: any) {
    logger.error(`Elasticsearch indexing failure for job ${emailJob.id}`, err);
  }
}

export async function searchEmails(queryText: string, userId: string) {
  if (!esClient) {
    logger.warn('Elasticsearch client is unavailable. Returning empty search results.');
    return [];
  }
  try {
    const response = await esClient.search({
      index: INDEX_NAME,
      query: {
        bool: {
          must: [
            {
              term: { userId: userId }
            },
            {
              multi_match: {
                query: queryText,
                fields: ['recipient', 'subject', 'body'],
                fuzziness: 'AUTO',
              },
            },
          ],
        },
      },
    });

    const hits = response.hits.hits;
    return hits.map((hit: any) => hit._source);
  } catch (err: any) {
    logger.error('Elasticsearch search failure', err);
    return [];
  }
}
