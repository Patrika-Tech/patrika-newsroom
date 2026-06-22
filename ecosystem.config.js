/**
 * PM2 ecosystem config for Patrika Newsroom
 *
 * Usage:
 *   pm2 start ecosystem.config.js          # start
 *   pm2 reload ecosystem.config.js         # zero-downtime reload
 *   pm2 stop patrika-newsroom              # stop
 *   pm2 logs patrika-newsroom              # live logs
 */
module.exports = {
  apps: [
    {
      name: 'patrika-newsroom',
      script: 'server.js',
      instances: 1,               // increase to 'max' for multi-core if needed
      exec_mode: 'fork',
      watch: false,               // don't watch files in production
      max_memory_restart: '512M',

      // Environment variables (override with .env file on the server)
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },

      // Log files
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // Auto-restart settings
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
};
