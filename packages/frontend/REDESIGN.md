# Обновление интерфейса DocxGen

## Направление

Развитие существующего стиля, без изменения маршрутов и бэкенда.
Сохранены название, шрифтовой логотип, бордовый акцент, пункты навигации и каталог типов/шаблонов.
Основные проблемы исходной версии: слишком крупная антиква на первом экране,
низкая заметность полей, отсутствие мобильной навигации и переключателя темы.
Новая основа: Golos Text, светлые нейтральные поверхности, бордовые действия, мягкие границы.
Дизайн / движение / плотность: 6 / 5 / 4.

## Что добавлено

- Светлая и тёмная темы с системным значением по умолчанию и сохранением выбора.
- Адаптивная главная, переключаемые примеры, каталог с предпросмотром двух шаблонов.
- Объёмная иллюстрация с наклоном от указателя; spring motion values не вызывают React render на каждом движении.
- Появление секций при прокрутке, обратная связь кнопок и переход между состояниями редактора.
- Локальный пример черновика, счётчик символов, живой предпросмотр текста и реквизитов.
- Отдельные визуальные состояния обработки, завершения и ошибки.
- Мобильное меню с Escape, подписи полей, фокус клавиатуры и ссылка перехода к содержимому.
- Отключение движения при prefers-reduced-motion, непрозрачная шапка при reduced transparency.
- Отложенная загрузка редактора и локальные шрифты с лицензиями OFL.
- SVG favicon из уже установленного семейства Lucide.

Контрольные размеры: элементы управления 10px, панели 16px, крупные поверхности 24px.
Слои: шапка 40, Radix popover 50, ссылка перехода к содержимому 60.
Предпросмотр показывает структуру. Он подписан как пример и не обещает точного совпадения с Word.

## Проверки

- Production build и TypeScript: успешно.
- Vitest: 37 тестов, включая отсутствие отправки при вставке примера, синхронизацию реквизитов с предпросмотром и завершение визуального состояния ожидания.
- Oxlint: без ошибок; два существующих предупреждения Fast Refresh о совместном экспорте компонентов и вариантов в button/textarea.
- Браузер: широкая вёрстка, 390px и 320px, обе темы, меню/Escape, выбор примеров и шаблонов.
- Состояния review/processing/generating/ready/error проверены на временном стенде с локальными данными. Стенд удалён.
- API-вызовы, Redux store, сервер и бизнес-логика не изменены. Полная генерация через реальный сервер не проверялась: backend на порту 3000 не был запущен.
- Мобильный снимок Lighthouse во время QA: Performance 95, Accessibility 100, Best Practices 100, SEO 92.
  SEO-предупреждение связано с robots.txt в локальном Vite preview. CLI создал полный отчёт, затем завершился с EPERM при удалении собственного временного профиля Chrome в Windows.
- После Lighthouse дополнительно уменьшены изображения для узких экранов и уточнена вёрстка 320px.
- Пользовательская папка design/ и прочие исходные материалы не изменялись.

## Иллюстрация

Создана встроенным imagegen. Используемые файлы:
- public/images/document-sculpture.webp (1536px, 41 KB)
- public/images/document-sculpture-1024.webp (19 KB)
- public/images/document-sculpture-640.webp (9 KB)

Исходный PNG сохранён инструментом в каталоге generated_images; в приложение скопирована и оптимизирована его версия.
Это 3D-рендер с CSS-перспективой, а не WebGL-сцена. Дополнительный 3D-движок не нужен.

Prompt:
> Create a premium 3D rendered sculptural still life for the hero of DocxGen, a document editing web application. Landscape composition 3:2. A small stack of 3 immaculate off-white A4 sheets floats diagonally above a matte very pale rose-grey surface, front sheet gently curling at its top right corner, beautiful realistic paper thickness and fine texture. A substantial translucent deep burgundy glass rounded square with an embossed checkmark rests floating beside the bottom right of the paper stack. One slender brushed silver paperclip. Three-quarter isometric camera, refined studio product photography, soft directional daylight, delicate ambient shadows, tactile materials, restrained composition with generous negative space at edges. The paper is blank except subtle grey typesetting strokes, no readable text, no letters, no logos, no watermark, no interface or UI badges. Background solid pale rose-grey #f0eded, no gradients or glowing clouds. All objects fully in frame, central compact composition, refined contemporary productivity brand, photorealistic Octane-quality CGI. Save generated asset for use in a real website.

## Источники

- [Motion: useReducedMotion](https://motion.dev/docs/react-use-reduced-motion)
- [MDN: transform-style](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transform-style)
- [Golos Text, Google Fonts](https://github.com/google/fonts/tree/main/ofl/golostext)
- [Cormorant Garamond, Google Fonts](https://github.com/google/fonts/tree/main/ofl/cormorantgaramond)
