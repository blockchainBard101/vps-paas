const path = require('path');

module.exports = {
  apps: [
    {
      name: 'paas-server',
      cwd: path.resolve(__dirname, 'apps/server'),
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        DATA_DIR: process.env.DATA_DIR || '/var/lib/paas',
      },
    },
    {
      name: 'paas-web',
      cwd: __dirname,
      script: 'npm',
      args: 'run start --workspace=web',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PAAS_WEB_PORT || process.env.PORT || 3000,
      },
    },
  ],
};
