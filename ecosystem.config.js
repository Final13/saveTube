module.exports = {
  apps: [
    {
      name: "savetube",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      cwd: "/var/www/save-tube/data/savetube",
      // Системная Node на сервере — 20.x, а undici@8 требует >= 22.19 → юзерспейсная Node 22
      interpreter: "/var/www/save-tube/data/opt/node22/bin/node",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      instances: 1,
      exec_mode: "fork",
    },
  ],
};
