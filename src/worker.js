// Отдельный процесс — запускается как второй systemd-сервис (не вместе с server.js).
// Разбирает "тяжёлую" очередь: отложенные шаги сценария (delay-нода) и рассылки.
import { Worker } from 'bullmq';
import { connection } from './queue.js';
import { query } from './db.js';
import { decryptToken } from './crypto.js';
import { runFrom } from './scenario-engine.js';
import 'dotenv/config';

const RATE_LIMIT_PER_BOT = 25; // сообщений/сек, с запасом от лимита Telegram в 30

async function loadBotAndScenario(botId) {
  const { rows } = await query(
    `SELECT b.id, b.telegram_token, s.data AS scenario FROM bots b
     JOIN scenarios s ON s.bot_id = b.id WHERE b.id=$1`, [botId]
  );
  if (!rows.length) return null;
  return { bot: { id: rows[0].id, telegramToken: decryptToken(rows[0].telegram_token) }, scenario: rows[0].scenario };
}

new Worker('flowgram-heavy', async job => {
  if (job.name === 'continue-scenario') {
    const { botId, chatId, nodeId } = job.data;
    const loaded = await loadBotAndScenario(botId);
    if (!loaded || !nodeId) return;
    await runFrom(loaded.bot, chatId, loaded.scenario, nodeId);
  }

  if (job.name === 'broadcast') {
    const { broadcastId } = job.data;
    const { rows } = await query('SELECT * FROM broadcasts WHERE id=$1', [broadcastId]);
    const broadcast = rows[0];
    if (!broadcast) return;
    const loaded = await loadBotAndScenario(broadcast.bot_id);
    if (!loaded) return;

    const { rows: users } = await query(
      `SELECT chat_id FROM bot_users WHERE bot_id=$1 AND status='active'`, [broadcast.bot_id]
    );

    await query(`UPDATE broadcasts SET status='sending', total=$2 WHERE id=$1`, [broadcastId, users.length]);

    let delivered = 0;
    for (const u of users) {
      try {
        await fetch(`https://api.telegram.org/bot${loaded.bot.telegramToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: u.chat_id, text: broadcast.text })
        });
        delivered++;
      } catch { /* пользователь мог заблокировать бота — пропускаем, не роняем всю рассылку */ }
      await new Promise(r => setTimeout(r, 1000 / RATE_LIMIT_PER_BOT)); // держим лимит Telegram
    }

    await query(`UPDATE broadcasts SET status='done', delivered=$2 WHERE id=$1`, [broadcastId, delivered]);
  }
}, { connection, concurrency: 5 });

console.log('Flowgram worker started');
