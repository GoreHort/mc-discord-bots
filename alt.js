const { DiscordMCBot } = require('./core.js');

const altConfig = {
  discordToken: (process.env.B2_DISCORD_TOKEN || '').trim(),
  discordChannelId: process.env.BOT2_CHANNEL_ID || '1416844931166769182',
  allowedUserId: process.env.B2_ALLOWED_USER_ID || process.env.ALLOWED_USER_ID || '287281397922529283',
  discordGuildId: process.env.B2_DISCORD_GUILD_ID || process.env.DISCORD_GUILD_ID || '1218299385293705248',

  mcHost: process.env.B2_MC_HOST || process.env.MC_HOST || 'mc.ultranetwork.net',
  mcUsername: (process.env.B2_MC_USERNAME || '').trim(),
  mcAuth: process.env.B2_MC_AUTH || 'microsoft',
  mcVersion: process.env.B2_MC_VERSION || '1.20.5',

  commandPrefix: 'b2',
  wsPort: Number(process.env.B2_WS_PORT || 3001),
  defaultMode: 'survival',
  autostart: true
};

if (!altConfig.discordToken) {
  console.error('Missing B2_DISCORD_TOKEN environment variable.');
  process.exit(1);
}

if (!altConfig.mcUsername) {
  console.error('Missing B2_MC_USERNAME environment variable.');
  process.exit(1);
}

const instance = new DiscordMCBot(altConfig);
