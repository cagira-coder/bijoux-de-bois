// Configuration pm2 de la boutique (même outil que les autres applications du VPS).
// Commandes utiles sur le VPS : pm2 list, pm2 logs boutique, pm2 restart boutique
module.exports = {
  apps: [
    {
      name: 'boutique',
      script: 'server.js',
      cwd: '/var/www/boutique',
      env: { NODE_ENV: 'production', PORT: 3020 },
      max_memory_restart: '300M',
      time: true,
    },
  ],
};
