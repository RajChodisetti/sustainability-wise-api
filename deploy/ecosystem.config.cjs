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
  ],
};
