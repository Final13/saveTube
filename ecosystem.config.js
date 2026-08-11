module.exports = {
  apps: [
    {
      name: "savetube",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      cwd: "/var/www/save-tube/data/savetube",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      instances: 1,
      exec_mode: "fork",
    },
  ],
};
