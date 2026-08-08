import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Оригинал сайта — URL со слэшем на конце (WP-стиль), canonical/ссылки/sitemap у нас тоже.
  // Иначе Next 308-редиректит /page/ → /page и canonical расходится с финальным URL.
  trailingSlash: true,
};

export default nextConfig;
