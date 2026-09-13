import { useCallback, useEffect, useState } from 'react';

/**
 * Роутинг на хэше, без зависимостей и без настройки сервера.
 *
 * Лендинг живёт на «/», форма — на «/#/new». Хэш выбран намеренно: раздача
 * собранного фронтенда сейчас никак не настроена, и при обычных путях прямая
 * ссылка на /new упёрлась бы в 404. Здесь же работают и кнопка «назад»,
 * и ссылка, которую можно переслать.
 */
export type Route = 'landing' | 'app';

const toRoute = (hash: string): Route => {
  const value = hash.replace(/^#/, '');
  return value === '/new' || value.startsWith('/new?') ? 'app' : 'landing';
};

export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => toRoute(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(toRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    window.location.hash = next === 'app' ? '/new' : '/';
    window.scrollTo({ top: 0 });
  }, []);

  return { route, navigate };
}
