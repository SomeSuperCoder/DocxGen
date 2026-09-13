// Подмена Python-сайдкара Vosk: отвечает на один запрос и завершается, как упавший процесс.
import readline from 'node:readline';

const lines = readline.createInterface({ input: process.stdin });
lines.once('line', () => {
  process.stdout.write(`${JSON.stringify({ text: 'прошу выделить ноутбук' })}\n`, () => process.exit(1));
});
