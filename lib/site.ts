export const SITE_NAME = "Save-Tube.ru";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
  /\/+$/,
  "",
);

export const SITE_DESCRIPTION =
  "Бесплатный онлайн-загрузчик для скачивания видео с RuTube. Сохраняйте ролики в MP4, MP3, Full HD и 4K без регистрации и программ.";

export const SUPPORT_EMAIL = "s@save-tube.ru";
