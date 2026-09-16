import express from 'express';
import { query } from './db.js';
import { encryptToken } from './crypto.js';
import 'dotenv/config';

export const botsRouter = express.Router();

// POST /api/bots { token, name }  — подключение нового бота (шаг из модалки в /app)
botsRouter.post('/bots', async (req, res) => {
  const { token, name, ownerId } = req.body; // ownerId — из сессии/JWT в реальной авторизации, здесь упрощено
  if (!token) return res.status(400).json({ error: 'token required' });

  // 1. проверяем токен через Telegram API — он сам скажет, валиден ли токен, и вернёт username
  const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const me = await meRes.json();
  if (!me.ok) return res.status(400).json({ error: 'invalid telegram token' });

  // 2. сохраняем бота с зашифрованным токеном
  const { rows } = await query(
    `INSERT INTO bots (owner_id, name, telegram_token, telegram_username, status)
     VALUES ($1, $2, $3, $4, 'draft') RETURNING id`,
    [ownerId, name || me.result.first_name, encryptToken(token), me.result.username]
  );
  const botId = rows[0].id;

  // 3. создаём пустой сценарий — просто триггер /start без продолжения
  await query(
    `INSERT INTO scenarios (bot_id, data, version) VALUES ($1, $2, 1)`,
    [botId, JSON.stringify({ trigger: '/start', nodes: [{ id: 'n1', type: 'trigger', data: {}, next: {} }] })]
  );

  // 4. регистрируем вебхук — с этого момента Telegram шлёт сообщения на наш общий эндпоинт
  const webhookUrl = `${process.env.PUBLIC_API_URL}/api/webhook/${botId}`;
  await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl })
  });

  await query(`UPDATE bots SET status='active' WHERE id=$1`, [botId]);

  res.json({ id: botId, username: me.result.username });
});
