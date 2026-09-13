export function createVkLongPoller({ client, groupId, onEvent, log = console, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  let stopped = false; let serverInfo;
  async function connect() { serverInfo = await client.api.groups.getLongPollServer({ group_id: Number(groupId) }); log.debug?.({ groupId, ts: serverInfo.ts }, 'ВК: long poll сервер получен'); }
  // Обработчик не ждём, как и callback: распознавание голосового или рендер у одного собеседника не должны
  // задерживать опрос и остальных. Порядок внутри диалога держит диспетчер — accept и очередь по собеседнику
  // занимаются синхронно, в порядке вызова. Сбой одного обновления не теряет остальные из пачки.
  function dispatch(update) {
    Promise.resolve().then(() => onEvent(update)).catch((err) => log.error?.({ err }, 'ВК: обновление не обработано'));
  }
  // Пустые циклы не логируем — их десятки в минуту; только старт, батчи с событиями и ошибки.
  async function run() { log.debug?.({ groupId }, 'ВК: long poll запущен'); while (!stopped) { try { if (!serverInfo) await connect(); const url = new URL(serverInfo.server); url.searchParams.set('act', 'a_check'); url.searchParams.set('key', serverInfo.key); url.searchParams.set('ts', serverInfo.ts); url.searchParams.set('wait', '25'); const response = await fetchImpl(url); const data = await response.json(); if (data.failed === 1) serverInfo.ts = data.ts; else if (data.failed === 2 || data.failed === 3) { log.debug?.({ failed: data.failed }, 'ВК: ключ устарел, переподключение'); serverInfo = null; } else { serverInfo.ts = data.ts; const updates = data.updates ?? []; if (updates.length) log.debug?.({ updates: updates.length, ts: data.ts }, 'ВК: получены обновления'); for (const update of updates) dispatch(update); } } catch (err) { log.error?.({ err }, 'vk long poll failed'); serverInfo = null; await sleep(3000); } } }
  return { start: run, stop: () => { stopped = true; } };
}
