module.exports = {
  apps: [
    {
      name: 'tanta-delivery-bot',
      script: 'index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        ENABLE_BAILEYS: 'true'
      }
    }
  ]
};
