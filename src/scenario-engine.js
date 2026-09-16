// Минимальный движок исполнения сценария — интерпретирует JSON, который отдаёт
// builder.html (toScenarioJson()). Это MVP: без параллельных веток, без ретраев HTTP,
// без тайм-аутов на condition/http — этого достаточно, чтобы дойти до рабочего прототипа,
// но перед реальной нагрузкой нужно решить обработку ошибок отдельно.

import { query } from './db.js';
import { enqueueContinue } from './queue.js';

function findNode(scenario, nodeId) {
  return scenario.nodes.find(n => n.id === nodeId) || null;
}

// возвращает id следующей ноды по имени выхода (порт), либо null если сценарий обрывается
function nextNodeId(node, portLabel) {
  if (!node.next) return null;
  return node.next[portLabel] ?? null;
}

export async function startScenario(bot, chatId, scenario) {
  const trigger = scenario.nodes.find(n => n.type === 'trigger');
  if (!trigger) return;
  const firstId = nextNodeId(trigger, '→');
  await runFrom(bot, chatId, scenario, firstId);
}

export async function runFrom(bot, chatId, scenario, nodeId) {
  const node = findNode(scenario, nodeId);
  if (!node) {
    await setCurrentNode(bot.id, chatId, null); // сценарий закончился
    return;
  }

  switch (node.type) {
    case 'message': {
      await sendMessage(bot, chatId, node.data.text || '');
      await logMessage(bot.id, chatId, 'out', node.id);
      const next = nextNodeId(node, '→');
      await runFrom(bot, chatId, scenario, next); // сообщение не ждёт ответа — идём дальше сразу
      break;
    }

    case 'buttons': {
      const labels = node.data.buttons || [];
      await sendMessage(bot, chatId, node.data.text || 'Выберите вариант:', {
        inline_keyboard: [labels.map((l, i) => ({ text: l, callback_data: `${node.id}:${i}` }))]
      });
      await logMessage(bot.id, chatId, 'out', node.id);
      await setCurrentNode(bot.id, chatId, node.id); // ждём callback_query от пользователя
      break;
    }

    case 'condition': {
      const vars = await getVars(bot.id, chatId);
      const match = String(vars[node.data.variable]) === String(node.data.value);
      const next = nextNodeId(node, match ? 'Да' : 'Нет');
      await runFrom(bot, chatId, scenario, next); // условие не требует сети — считаем сразу
      break;
    }

    case 'delay': {
      const seconds = Number(node.data.seconds) || 0;
      const next = nextNodeId(node, '→');
      // не блокируем воркер вебхука — откладываем продолжение через очередь
      await enqueueContinue(bot.id, chatId, next, seconds * 1000);
      break;
    }

    case 'http': {
      // синхронный HTTP только для быстрых интеграций; таймаут короткий намеренно —
      // долгие запросы должны идти через отдельную "тяжёлую" HTTP-ноду в очереди (TODO)
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(node.data.url, { signal: controller.signal });
        clearTimeout(timeout);
        const outcome = res.ok ? 'default' : 'error';
        const next = nextNodeId(node, outcome) ?? nextNodeId(node, '→');
        await runFrom(bot, chatId, scenario, next);
      } catch {
        const next = nextNodeId(node, 'error') ?? null;
        await runFrom(bot, chatId, scenario, next);
      }
      break;
    }

    case 'payment': {
      // здесь только постановка задачи — реальный вызов ЮKassa/Robokassa зависит от
      // integrations бота, это отдельный модуль (src/payments/*.js), намеренно не включён в MVP
      await setCurrentNode(bot.id, chatId, node.id);
      break;
    }

    default:
      await setCurrentNode(bot.id, chatId, null);
  }
}

// обработка ответа пользователя (нажатие кнопки), когда сценарий "ждёт" на buttons-ноде
export async function handleCallback(bot, chatId, scenario, callbackData) {
  const [nodeId, portIndexStr] = callbackData.split(':');
  const node = findNode(scenario, nodeId);
  if (!node || node.type !== 'buttons') return;
  const portIndex = Number(portIndexStr);
  const label = (node.data.buttons || [])[portIndex];
  const next = nextNodeId(node, label);
  await logMessage(bot.id, chatId, 'in', nodeId);
  await runFrom(bot, chatId, scenario, next);
}

async function getVars(botId, chatId) {
  const { rows } = await query('SELECT vars FROM bot_users WHERE bot_id=$1 AND chat_id=$2', [botId, chatId]);
  return rows[0]?.vars || {};
}

async function setCurrentNode(botId, chatId, nodeId) {
  await query(
    `INSERT INTO bot_users (bot_id, chat_id, vars, last_seen_at)
     VALUES ($1, $2, jsonb_build_object('_current_node', $3::text), now())
     ON CONFLICT (bot_id, chat_id) DO UPDATE
       SET vars = bot_users.vars || jsonb_build_object('_current_node', $3::text),
           last_seen_at = now()`,
    [botId, chatId, nodeId]
  );
}

async function logMessage(botId, chatId, direction, nodeId) {
  await query('INSERT INTO messages_log (bot_id, chat_id, direction, node_id) VALUES ($1,$2,$3,$4)',
    [botId, chatId, direction, nodeId]);
}

async function sendMessage(bot, chatId, text, replyMarkup) {
  const url = `https://api.telegram.org/bot${bot.telegramToken}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup })
  });
}
