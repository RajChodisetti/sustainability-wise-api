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
      watch: false,
      max_memory_restart: '1500M',
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
