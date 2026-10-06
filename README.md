# Рядом

Приложение для владельцев питомцев: календарь, здоровье, документы, запасы и занятия.

**Открыть:** https://pavelmashina.github.io/ryadom-app/

Вход и регистрация через Supabase Email/Password. Данные сохраняются в аккаунте; нужен интернет. На телефоне сайт можно добавить на главный экран. Старые облачные записи переносятся при входе; общие данные браузера автоматически не импортируются.

## Разработка

Node.js 24 и pnpm. Скопируйте `.env.example` в `.env.local`, заполните публичные настройки Supabase. Никогда не помещайте service role / secret key в VITE_.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
```

Миграции — в `supabase/migrations`. GitHub Actions проверяет тесты, собирает приложение и публикует GitHub Pages при обновлении main.

Подробности функций, структуры, защиты и проверок: [отчёт](docs/implementation-report.md).
