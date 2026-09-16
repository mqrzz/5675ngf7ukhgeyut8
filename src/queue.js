import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import 'dotenv/config';

export const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

// heavyQueue — всё, что не должно выполняться синхронно внутри вебхука:
// рассылки, отложенные шаги (delay-нода), тяжёлые HTTP-запросы
export const heavyQueue = new Queue('flowgram-heavy', { connection });

export async function enqueueContinue(botId, chatId, nodeId, delayMs = 0) {
  await heavyQueue.add('continue-scenario', { botId, chatId, nodeId }, { delay: delayMs });
}

export async function enqueueBroadcast(broadcastId) {
  await heavyQueue.add('broadcast', { broadcastId });
}
