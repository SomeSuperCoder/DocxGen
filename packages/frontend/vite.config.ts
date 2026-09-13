import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Единственный backend слушает PORT. Прокси должен использовать тот же порт,
// иначе запросы /api молча упираются в ECONNREFUSED.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(import.meta.dirname, '../..'), '')
  const target = `http://localhost:${env.PORT || '3000'}`

  return {
    plugins: [react(), tailwindcss()],
    server: {
      // По умолчанию Vite слушает только ::1, и http://localhost по IPv4 упирается в
      // «отказано в подключении». 127.0.0.1 доступен и как localhost, и напрямую.
      host: '127.0.0.1',
      proxy: {
        // /api/audio тоже идёт в backend: он добавляет владельца из cookie и ключ аудиосервиса.
        '/api': target,
        '/health': target,
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
  }
})
