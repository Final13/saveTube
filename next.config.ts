import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Нативный модуль SQLite: не бандлить, подключать из node_modules на сервере
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
