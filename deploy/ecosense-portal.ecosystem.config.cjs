const path = require('node:path');

const portalRoot = process.env.ECOSENSE_PORTAL_ROOT
  ? path.resolve(process.env.ECOSENSE_PORTAL_ROOT)
  : path.resolve(__dirname, '..', 'apps', 'ecoaudit');

const registrationEnabled =
  process.env.PORTAL_REGISTRATION_ENABLED?.toLowerCase() === 'true' ? 'true' : 'false';
const portalPort = process.env.ECOSENSE_PORTAL_PORT ?? '3210';

module.exports = {
  apps: [
    {
      name: 'ecosense-portal',
      cwd: portalRoot,
      script: 'node_modules/next/dist/bin/next',
      interpreter: 'node',
      args: `start --hostname 127.0.0.1 --port ${portalPort}`,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
      max_memory_restart: '1G',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env_production: {
        NODE_ENV: 'production',
        HOSTNAME: '127.0.0.1',
        PORT: portalPort,
        INTERNAL_API_URL: process.env.INTERNAL_API_URL ?? 'http://127.0.0.1:3000',
        PORTAL_REGISTRATION_ENABLED: registrationEnabled,
        ...(process.env.REGISTRATION_SECRET
          ? { REGISTRATION_SECRET: process.env.REGISTRATION_SECRET }
          : {}),
      },
    },
  ],
};
