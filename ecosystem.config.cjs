module.exports = {
  apps: [
    {
      name: 'tanta-delivery-bot',
      script: 'bot.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
