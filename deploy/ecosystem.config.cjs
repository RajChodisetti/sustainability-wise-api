module.exports = {
  apps: [
    {
      name: 'sw-api',
      script: 'src/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx/esm',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
      max_memory_restart: '1500M',
      error_file: '/var/log/sw-api/error.log',
      out_file: '/var/log/sw-api/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env_production: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'ww-fleet-monitor',
      script: 'monitor.py',
      interpreter: '/opt/ww-monitor/.venv/bin/python3',
      cwd: '/opt/ww-monitor',
      instances: 1,
      exec_mode: 'fork',
      // Server runs UTC; this is 07:00 AEST daily.
      cron_restart: '0 21 * * *',
      autorestart: false,
      watch: false,
      error_file: '/var/log/ww-monitor/error.log',
      out_file: '/var/log/ww-monitor/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
