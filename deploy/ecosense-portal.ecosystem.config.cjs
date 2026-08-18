const path = require('node:path');

const portalRoot = process.env.ECOSENSE_PORTAL_ROOT
  ? path.resolve(process.env.ECOSENSE_PORTAL_ROOT)
  : path.resolve(__dirname, '..', 'apps', 'ecoaudit');

const registrationEnabled =
  process.env.PORTAL_REGISTRATION_ENABLED?.toLowerCase() === 'true' ? 'true' : 'false';
const hideEcoAuditSolarSenseSchedulerJobs =
  /^(?:1|true|yes|on)$/i.test(
    process.env.SCHEDULER_HIDE_ECOAUDIT_SOLARSENSE_JOBS ?? '',
  )
    ? 'true'
    : 'false';
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
        SCHEDULER_HIDE_ECOAUDIT_SOLARSENSE_JOBS: hideEcoAuditSolarSenseSchedulerJobs,
        ...(process.env.ECOAUDIT_REGISTRATION_SECRET
          ? { ECOAUDIT_REGISTRATION_SECRET: process.env.ECOAUDIT_REGISTRATION_SECRET }
          : {}),
        ...(process.env.SOLARSENSE_REGISTRATION_SECRET
          ? { SOLARSENSE_REGISTRATION_SECRET: process.env.SOLARSENSE_REGISTRATION_SECRET }
          : {}),
      },
    },
  ],
};
