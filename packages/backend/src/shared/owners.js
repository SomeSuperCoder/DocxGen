/**
 * Правила делегирования владельца для транспортных адаптеров и внешних вызовов.
 *
 * Встроенные MAX/VK/local-адаптеры действуют от имени пользователя через
 * owner-bound client. Внешние HTTP-интеграции используют те же поля через
 * заголовки X-Owner-Platform и X-Owner-Id. Здесь описано, кем разрешено
 * представляться.
 *
 * Платформы 'web' в списке намеренно нет: веб-владелец — это значение cookie
 * сессии, и разрешить назначать его заголовком означало бы дать любому
 * возможность выдать себя за произвольного посетителя сайта.
 */

export const DELEGATABLE_PLATFORMS = Object.freeze(['max', 'vk']);

/** Идентификатор пользователя мессенджера: у MAX и ВК это числа, запас взят с избытком. */
const MAX_OWNER_ID_LENGTH = 128;

/**
 * @param {unknown} platform
 * @returns {boolean}
 */
export function isDelegatablePlatform(platform) {
  return typeof platform === 'string' && DELEGATABLE_PLATFORMS.includes(platform);
}

/**
 * Разобрать заголовки владельца. Возвращает null, если их нет,
 * и бросает DomainError-подобную причину отказа через строку, если они кривые.
 *
 * @param {Record<string, unknown>} headers
 * @returns {{ owner: { platform: string, id: string } | null, reason: string | null }}
 */
export function readOwnerHeaders(headers) {
  const platform = headers['x-owner-platform'];
  const id = headers['x-owner-id'];

  if (platform === undefined && id === undefined) return { owner: null, reason: null };

  if (!isDelegatablePlatform(platform)) {
    return { owner: null, reason: `Unknown owner platform: expected one of ${DELEGATABLE_PLATFORMS.join(', ')}` };
  }
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_OWNER_ID_LENGTH) {
    return { owner: null, reason: 'Owner id must be a non-empty string' };
  }

  return { owner: { platform, id }, reason: null };
}
