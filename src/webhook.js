import express from 'express';
import { query } from './db.js';
import { decryptToken } from './crypto.js';
import { startScenario, runFrom, handleCallback } from './scenario-engine.js';

export const webhookRouter = express.Router();

// один роут на всех ботов — bot_id приходит в пути, Telegram сам знает, куда стучаться,
// потому что этот URL мы регистрируем через setWebhook при подключении бота
webhookRouter.post('/webhook/:botId', async (req, res) => {
  const botId = Number(req.params.botId);

  // отвечаем Telegram сразу — вся обработка происходит уже после ответа,
  // чтобы не держать соединение и не словить таймаут при вспышке сообщений
  res.sendStatus(200);

  try {
    const { rows } = await query(
      `SELECT b.id, b.telegram_token, s.data AS scenario
       FROM bots b JOIN scenarios s ON s.bot_id = b.id
       WHERE b.id = $1 AND b.status = 'active'`,
      [botId]
    );
    if (!rows.length) return; // бот не найден или не опубликован — тихо игнорируем
    const bot = { id: rows[0].id, telegramToken: decryptToken(rows[0].telegram_token) };
    const scenario = rows[0].scenario;

    const update = req.body;

    if (update.callback_query) {
      const chatId = update.callback_query.message.chat.id;
      await handleCallback(bot, chatId, scenario, update.callback_query.data);
      return;
    }

    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || '';

      await query(
        `INSERT INTO bot_users (bot_id, chat_id, last_seen_at) VALUES ($1,$2, now())
         ON CONFLICT (bot_id, chat_id) DO UPDATE SET last_seen_at = now()`,
        [bot.id, chatId]
      );

      if (text === scenario.trigger) {
        await startScenario(bot, chatId, scenario);
        return;
      }

      // не /start — проверяем, не "висит" ли пользователь на ноде, ожидающей текстового ввода
      const { rows: uRows } = await query('SELECT vars FROM bot_users WHERE bot_id=$1 AND chat_id=$2', [bot.id, chatId]);
      const currentNodeId = uRows[0]?.vars?._current_node;
      if (currentNodeId) {
        await runFrom(bot, chatId, scenario, currentNodeId);
      }
      // иначе — сообщение вне сценария, намеренно игнорируем в MVP
    }
  } catch (err) {
    // вебхук уже ответил 200 выше — эта ошибка только в лог, не влияет на Telegram
    console.error('webhook processing error:', err);
  }
});
