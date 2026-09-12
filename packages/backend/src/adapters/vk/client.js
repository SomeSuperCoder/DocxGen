import { API, APIError, Upload } from 'vk-io';

export function createVkClient({ token, apiVersion = '5.199', api, upload } = {}) {
  const client = api ?? new API({ token, apiVersion }); const uploader = upload ?? new Upload({ api: client });
  return { api: client, sendMessage: ({ peerId, randomId, message, keyboard, attachment }) => client.messages.send({ peer_id: Number(peerId), random_id: randomId, message, keyboard, attachment, dont_parse_links: 1 }), uploadDoc: async (peerId, buffer, filename) => String(await uploader.messageDocument({ peer_id: Number(peerId), source: { value: buffer, filename } })), uploadPhoto: async (peerId, buffer, filename = 'image.png') => String(await uploader.messagePhoto({ peer_id: Number(peerId), source: { value: buffer, filename, contentType: 'image/png' } })), isRetryable: (err) => err instanceof APIError ? [6, 9, 10].includes(err.code) : err?.code === undefined || [6, 9, 10].includes(err.code) };
}
