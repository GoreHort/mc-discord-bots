const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const mineflayer = require('mineflayer');
const { Client, GatewayIntentBits, Routes, SlashCommandBuilder, REST, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { pathfinder, goals, Movements } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const { createCanvas } = require('@napi-rs/canvas');

function flattenComponent(comp) {
  if (typeof comp === 'string') return comp;
  if (Array.isArray(comp)) return comp.map(flattenComponent).join('');
  if (comp && typeof comp === 'object') {
    const isObfuscated = comp.obfuscated || (comp.json && comp.json.obfuscated);
    if (isObfuscated) {
      const raw = (typeof comp.text === 'string' ? comp.text : '') || (comp.json && typeof comp.json.text === 'string' ? comp.json.text : '');
      return raw.replace(/\S/g, ''); 
    }
    let out = '';
    if (typeof comp.text === 'string') out += comp.text;
    if (typeof comp[''] === 'string') out += comp[''];
    if (comp.json && typeof comp.json[''] === 'string') out += comp.json[''];
    if (Array.isArray(comp.extra)) out += flattenComponent(comp.extra);
    if (Array.isArray(comp.with)) out += comp.with.map(flattenComponent).join('');
    return out;
  }
  return '';
}

function normalizeReason(reason) {
  return (flattenComponent(reason) || (typeof reason === 'string' ? reason : '') || 'unknown').toString().trim().toLowerCase();
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeDiscordMarkdown(text) {
  return text
    .replace(/^(\s*)-(?=\s)/gm, '$1\\-')
    .replace(/^(\s*)\*(?=\s)/gm, '$1\\*')
    .replace(/^(\s*)#/gm, '$1\\#')
    .replace(/^>/gm, '\\>');
}

const RANK_ORDER = [
  'Owner', 'Admin', 'Mod', 'Helper',
  'Void', 'Totem', 'Netherite', 'Elytra', 'Emerald',
  'Diamond', 'Gold', 'Lapis', 'Redstone', 'Iron', 'Coal', 'Bedrock', 'Member'
];

const RANK_COLORS = {
  Owner: '#ef4444',
  Admin: '#f97316',
  Mod: '#eab308',
  Helper: '#06b6d4',
  Void: '#a855f7',
  Totem: '#f59e0b',
  Netherite: '#6366f1',
  Elytra: '#06b6d4',
  Emerald: '#22c55e',
  Diamond: '#38bdf8',
  Gold: '#eab308',
  Lapis: '#3b82f6',
  Redstone: '#ef4444',
  Iron: '#cbd5e1',
  Coal: '#64748b',
  Bedrock: '#94a3b8',
  Member: '#94a3b8'
};

function formatChatLine(rawText) {
  if (!rawText) return '';
  const clean = rawText.replace(/§[0-9a-fk-or]/gi, '').trim();

  // Match chat line: [Rank] Player [Tag] » Message
  const arrowMatch = clean.match(/^(.+?\s*»)\s*(.*)$/);
  if (arrowMatch) {
    const sender = arrowMatch[1].trim().replace(/_/g, '\\_');
    const msg = arrowMatch[2];
    return `**${sender}** ${escapeDiscordMarkdown(msg)}`;
  }

  // Match [Rank] Player: message
  const colonMatch = clean.match(/^(\[[^\]]+\]\s+[a-zA-Z0-9_]{2,16}\s*:)\s*(.*)$/);
  if (colonMatch) {
    const sender = colonMatch[1].trim().replace(/_/g, '\\_');
    const msg = colonMatch[2];
    return `**${sender}** ${escapeDiscordMarkdown(msg)}`;
  }

  // Match <Player> message
  const bracketMatch = clean.match(/^(<[a-zA-Z0-9_]{2,16}>)\s*(.*)$/);
  if (bracketMatch) {
    const sender = bracketMatch[1].replace(/_/g, '\\_');
    const msg = bracketMatch[2];
    return `**${sender}** ${escapeDiscordMarkdown(msg)}`;
  }

  return escapeDiscordMarkdown(clean);
}

function getItemEmoji(name = '') {
  const n = name.toLowerCase();
  if (n.includes('pickaxe')) return '⛏️';
  if (n.includes('sword')) return '⚔️';
  if (n.includes('axe')) return '🪓';
  if (n.includes('shovel')) return '🥄';
  if (n.includes('helmet') || n.includes('chestplate') || n.includes('leggings') || n.includes('boots')) return '🛡️';
  if (n.includes('pot')) return '🏺';
  if (n.includes('chest') || n.includes('shulker')) return '📦';
  if (n.includes('clock')) return '⏱️';
  if (n.includes('compass')) return '🧭';
  if (n.includes('head') || n.includes('skull')) return '👤';
  if (n.includes('crystal') || n.includes('diamond') || n.includes('emerald')) return '💎';
  if (n.includes('ingot') || n.includes('gold') || n.includes('iron')) return '🪙';
  if (n.includes('book')) return '📖';
  if (n.includes('bow') || n.includes('arrow')) return '🏹';
  if (n.includes('apple') || n.includes('bread') || n.includes('steak')) return '🍎';
  return '📦';
}

function getItemDisplayName(item) {
  if (!item) return '';
  if (item.customName) {
    try {
      const parsed = typeof item.customName === 'string' ? JSON.parse(item.customName) : item.customName;
      const flat = flattenComponent(parsed).replace(/§[0-9a-fk-or]/gi, '').trim();
      if (flat) return flat;
    } catch {}
    const raw = String(item.customName).replace(/§[0-9a-fk-or]/gi, '').trim();
    if (raw) return raw;
  }

  if (item.nbt && item.nbt.value && item.nbt.value.display && item.nbt.value.display.value) {
    const rawName = item.nbt.value.display.value.Name?.value;
    if (rawName) {
      try {
        const parsed = typeof rawName === 'string' ? JSON.parse(rawName) : rawName;
        const flat = flattenComponent(parsed).replace(/§[0-9a-fk-or]/gi, '').trim();
        if (flat) return flat;
      } catch {}
      const raw = String(rawName).replace(/§[0-9a-fk-or]/gi, '').trim();
      if (raw) return raw;
    }
  }

  if (item.displayName) {
    return item.displayName.replace(/§[0-9a-fk-or]/gi, '').trim();
  }

  return (item.name || 'Unknown').replace(/_/g, ' ');
}

function parsePlayer(p) {
  let raw = '';
  if (p.displayName) {
    raw = flattenComponent(p.displayName).trim();
  }
  if (!raw) raw = p.username || 'Unknown';
  const clean = raw.replace(/§[0-9a-fk-or]/gi, '').trim();

  for (const rank of RANK_ORDER) {
    if (rank === 'Member') continue;
    const regex = new RegExp(`^(?:\\[?${rank}\\]?\\s+)(.+)$`, 'i');
    const m = clean.match(regex);
    if (m) {
      return { rank, username: m[1].trim() };
    }
  }

  return { rank: 'Member', username: clean };
}

function renderInventoryCanvas(window, isContainer) {
  const slots = window.slots || [];
  const displaySlotsCount = isContainer ? Math.min(slots.length, window.inventoryStart || 54) : Math.min(slots.length, 36);
  const rows = Math.max(3, Math.ceil(displaySlotsCount / 9));

  const colCount = 9;
  const slotW = 72;
  const slotH = 72;
  const gap = 8;
  const paddingX = 24;
  const paddingTop = 65;
  const paddingBottom = 20;

  const width = paddingX * 2 + colCount * slotW + (colCount - 1) * gap;
  const height = paddingTop + rows * slotH + (rows - 1) * gap + paddingBottom;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  // Top header bar
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, width, 50);

  // Title text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px sans-serif';
  const title = isContainer ? 'Container / Server GUI' : 'Player Inventory';
  ctx.fillText(title, paddingX, 32);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px sans-serif';
  ctx.fillText(`${displaySlotsCount} slots`, width - paddingX - 60, 32);

  // Draw slots
  for (let i = 0; i < displaySlotsCount; i++) {
    const col = i % 9;
    const row = Math.floor(i / 9);
    const x = paddingX + col * (slotW + gap);
    const y = paddingTop + row * (slotH + gap);

    const item = slots[i];
    const isOccupied = Boolean(item);

    // Slot box
    ctx.fillStyle = isOccupied ? '#1e293b' : '#141c2e';
    ctx.fillRect(x, y, slotW, slotH);

    ctx.strokeStyle = isOccupied ? '#3b82f6' : '#273549';
    ctx.lineWidth = isOccupied ? 2 : 1;
    ctx.strokeRect(x, y, slotW, slotH);

    // Slot number in top-left
    ctx.fillStyle = isOccupied ? '#38bdf8' : '#475569';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`${i}`, x + 5, y + 14);

    if (item) {
      const displayName = getItemDisplayName(item);
      const emoji = getItemEmoji(item.name);

      // Emoji in center
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(emoji, x + slotW / 2, y + 36);

      // Truncated Display Name
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 10px sans-serif';
      const shortName = displayName.length > 9 ? displayName.slice(0, 8) + '..' : displayName;
      ctx.fillText(shortName, x + slotW / 2, y + 52);

      // Count in bottom right
      if (item.count > 1) {
        ctx.fillStyle = '#4ade80';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`x${item.count}`, x + slotW - 5, y + slotH - 5);
      }
      ctx.textAlign = 'left';
    }
  }

  return canvas.toBuffer('image/png');
}

function renderOnlinePlayersCanvas(players) {
  const grouped = new Map();
  for (const r of RANK_ORDER) grouped.set(r, []);

  for (const p of players) {
    const { rank, username } = parsePlayer(p);
    if (!grouped.has(rank)) grouped.set(rank, []);
    grouped.get(rank).push(username);
  }

  const activeRanks = [];
  for (const [rank, list] of grouped.entries()) {
    if (list.length > 0) {
      activeRanks.push({
        rank,
        color: RANK_COLORS[rank] || '#94a3b8',
        list: list.sort((a, b) => a.localeCompare(b))
      });
    }
  }

  const width = 880;
  const height = Math.max(380, 100 + activeRanks.length * 42);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, '#0f172a');
  bgGrad.addColorStop(1, '#1e1b4b');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Online indicator dot
  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.arc(36, 40, 7, 0, Math.PI * 2);
  ctx.fill();

  // Header Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(`UltraNetwork — Online Players (${players.length})`, 54, 47);

  // Divider
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(24, 70);
  ctx.lineTo(width - 24, 70);
  ctx.stroke();

  // Render each rank
  let currentY = 100;
  for (const { rank, color, list } of activeRanks) {
    // Rank badge pill
    const badgeText = `${rank.toUpperCase()} (${list.length})`;
    ctx.font = 'bold 12px sans-serif';
    const textW = ctx.measureText(badgeText).width;
    const badgeW = textW + 16;
    const badgeH = 24;

    ctx.fillStyle = color + '26'; // 15% opacity hex
    ctx.beginPath();
    ctx.roundRect(28, currentY - 17, badgeW, badgeH, 6);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillText(badgeText, 36, currentY);

    // Player names line
    ctx.fillStyle = '#f1f5f9';
    ctx.font = '14px sans-serif';
    const namesStr = list.join('  •  ');
    let displayNames = namesStr;
    const maxWidth = width - badgeW - 70;
    while (ctx.measureText(displayNames).width > maxWidth && displayNames.length > 10) {
      displayNames = displayNames.slice(0, -6) + '...';
    }

    ctx.fillText(displayNames, 36 + badgeW + 16, currentY);
    currentY += 38;
  }

  // Footer
  ctx.fillStyle = '#64748b';
  ctx.font = '12px sans-serif';
  ctx.fillText(`mc.ultranetwork.net • ${new Date().toLocaleTimeString()}`, 28, height - 16);

  return canvas.toBuffer('image/png');
}

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

class DiscordMCBot {
  constructor(config) {
    this.config = config;
    
    // Discord Client
    this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
    this.discordChannel = null;
    
    // Bot State
    this.mcBot = null;
    this.state = 'OFFLINE'; // OFFLINE, CONNECTING, ONLINE, RECONNECTING
    
    // State Persistence
    this.stateFilePath = path.join(__dirname, `.${this.config.commandPrefix}_state.json`);
    let initialManualStop = !config.autostart;
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const saved = JSON.parse(fs.readFileSync(this.stateFilePath, 'utf8'));
        if (typeof saved.manualStop === 'boolean') {
          initialManualStop = saved.manualStop;
        }
      }
    } catch (e) {}
    this.manualStop = initialManualStop;
    
    // Reconnect & Delays
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    
    // Game State
    this.autoNavigate = true;
    this.targetMode = config.defaultMode || 'prison';
    this.currentMode = this.targetMode;
    this.pendingModeSelection = false;
    this.modeClickInProgress = false;

    // Chat Batching & Embed Queue
    this.chatBuffer = [];
    this.chatFlushTimer = null;

    // Terminal Environment
    this.terminalCwd = process.env.HOME || '/FTP/discordbot';
    
    this.setupDiscord();
    this.setupWebSocket();
  }

  log(msg) {
    console.log(`[${this.config.commandPrefix.toUpperCase()}] ${msg}`);
  }

  saveState() {
    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify({ manualStop: this.manualStop }), 'utf8');
    } catch (e) {}
  }

  getSpecialEmbed(text) {
    if (!text) return null;
    const t = text.trim();

    // 1. Unscramble challenge: "Unscramble the word '...' for a reward!"
    if (/unscramble the word/i.test(t)) {
      return {
        description: `**${t}**`,
        color: 0x55FF55 // Lime Green
      };
    }

    // 2. Unscramble winners: "1st. G45 unscrambled the word in 2.32s"
    if (/^\d+(?:st|nd|rd|th)\.?\s+.*unscrambled the word/i.test(t)) {
      return {
        description: `**${t}**`,
        color: 0xFFAA00 // Gold / Orange
      };
    }

    // 3. Chat Reaction over: "Chat Reaction is over! The word was '...'"
    if (/chat reaction is over/i.test(t)) {
      return {
        description: `**${t}**`,
        color: 0x55FFFF // Aqua / Cyan
      };
    }

    // 4. Prestige: "... has prestiged their pickaxe to ..."
    if (/has prestiged their pickaxe to/i.test(t)) {
      return {
        description: `**${t}**`,
        color: 0x55FFFF // Aqua / Cyan
      };
    }

    // 5. Vault Key / Crate win: "... opened a ... Key and won ..."
    if (/opened a .* (?:vault )?key and won/i.test(t)) {
      return {
        description: `**${t}**`,
        color: 0xFF5555 // Red
      };
    }

    // 6. Vote party countdown: "... more votes until voteparty!"
    if (/more votes until voteparty/i.test(t)) {
      return {
        description: `**${t}**`,
        color: 0x55FFFF // Aqua / Cyan
      };
    }

    return null;
  }

  queueMessage(fullMessage) {
    const embed = this.getSpecialEmbed(fullMessage);
    if (embed) {
      this.flushChatQueue();
      if (this.discordChannel) {
        this.discordChannel.send({ embeds: [embed] }).catch(() => {});
      }
      return;
    }

    const formatted = formatChatLine(fullMessage);
    this.chatBuffer.push(formatted);
    if (this.chatBuffer.length >= 8 || this.chatBuffer.join('\n').length >= 1400) {
      this.flushChatQueue();
    } else if (!this.chatFlushTimer) {
      this.chatFlushTimer = setTimeout(() => {
        this.flushChatQueue();
      }, 1500);
    }
  }

  flushChatQueue() {
    if (this.chatFlushTimer) {
      clearTimeout(this.chatFlushTimer);
      this.chatFlushTimer = null;
    }
    if (!this.chatBuffer || this.chatBuffer.length === 0 || !this.discordChannel) return;

    const toSend = this.chatBuffer.join('\n').slice(0, 1900);
    this.chatBuffer = [];
    this.discordChannel.send(toSend).catch(() => {});
  }

  sendToDiscord(msg) {
    if (!this.discordChannel) return;
    this.flushChatQueue();
    this.discordChannel.send(escapeDiscordMarkdown(String(msg)).slice(0, 1900)).catch(() => {});
  }

  async setupDiscord() {
    const slashCommands = [
      new SlashCommandBuilder().setName(`${this.config.commandPrefix}autostart`).setDescription('Enable/disable auto-reconnect and start/stop the bot'),
      new SlashCommandBuilder().setName(`${this.config.commandPrefix}online`).setDescription('Show who is online on the server'),
      new SlashCommandBuilder().setName(`${this.config.commandPrefix}screen`).setDescription('Show bot GUI/inventory'),
      new SlashCommandBuilder().setName(`${this.config.commandPrefix}select`).setDescription('Click first item matching name or ID')
        .addStringOption(opt => opt.setName('item_id').setDescription('Item name/ID').setRequired(true)),
      new SlashCommandBuilder().setName(`${this.config.commandPrefix}click`).setDescription('Left-click a slot')
        .addIntegerOption(opt => opt.setName('slot').setDescription('Slot number').setRequired(true)),
      new SlashCommandBuilder().setName(`${this.config.commandPrefix}shiftclick`).setDescription('Shift-left-click a slot')
        .addIntegerOption(opt => opt.setName('slot').setDescription('Slot number').setRequired(true)),
      new SlashCommandBuilder().setName(`${this.config.commandPrefix}rightclick`).setDescription('Right-click selected/held item')
        .addIntegerOption(opt => opt.setName('slot').setDescription('Hotbar slot 0-8').setRequired(false)),
      new SlashCommandBuilder().setName(`${this.config.commandPrefix}slot`).setDescription('Select a hotbar slot')
        .addIntegerOption(opt => opt.setName('slot').setDescription('Hotbar slot 0-8').setRequired(true)),
      new SlashCommandBuilder().setName(`${this.config.commandPrefix}walk`).setDescription('Walk forward by blocks')
        .addIntegerOption(opt => opt.setName('steps').setDescription('Block steps').setRequired(true)),
      new SlashCommandBuilder().setName(`${this.config.commandPrefix}move`).setDescription('Move the bot in a direction by blocks')
        .addIntegerOption(opt => opt.setName('blocks').setDescription('Number of blocks to move').setRequired(true))
        .addStringOption(opt => opt.setName('direction').setDescription('Direction').setRequired(true).addChoices(
          { name: 'north', value: 'north' }, { name: 'south', value: 'south' }, { name: 'east', value: 'east' },
          { name: 'west', value: 'west' }, { name: 'forward', value: 'forward' }, { name: 'backward', value: 'backward' },
          { name: 'left', value: 'left' }, { name: 'right', value: 'right' }
        )),
      new SlashCommandBuilder().setName(`${this.config.commandPrefix}rotate`).setDescription('Rotate bot view')
        .addNumberOption(opt => opt.setName('yaw').setDescription('Yaw').setRequired(true))
        .addNumberOption(opt => opt.setName('pitch').setDescription('Pitch').setRequired(true)),
      new SlashCommandBuilder().setName(`${this.config.commandPrefix}relog`).setDescription('Toggle auto navigation after login'),
      new SlashCommandBuilder().setName(`${this.config.commandPrefix}closegui`).setDescription('Force close current GUI'),
      new SlashCommandBuilder().setName(`${this.config.commandPrefix}change`).setDescription('Change gamemode/server')
        .addStringOption(opt => opt.setName('mode').setDescription('Target mode').setRequired(true).addChoices(
          { name: 'prison', value: 'prison' }, { name: 'survival', value: 'survival' }
        ))
    ];

    this.client.once('ready', async () => {
      this.log(`Discord logged in as ${this.client.user.tag}`);
      try {
        this.discordChannel = await this.client.channels.fetch(this.config.discordChannelId);
      } catch (err) {
        this.log(`Failed to fetch channel: ${err.message}`);
      }

      if (this.config.terminalChannelId) {
        try {
          this.terminalChannel = await this.client.channels.fetch(this.config.terminalChannelId);
          this.log(`Terminal channel connected: #${this.terminalChannel.name} (${this.config.terminalChannelId})`);
          this.terminalChannel.send(`🟢 **Linux Terminal Online**\nConnected to \`${process.env.USER || 'bot'}@local\` (\`/FTP/discordbot\`).\nReady for commands from <@${this.config.allowedUserId}>.`).catch(() => {});
        } catch (err) {
          this.log(`Terminal channel fetch failed: ${err.message} (Check bot permissions in #${this.config.terminalChannelId})`);
        }
      }

      const rest = new REST({ version: '10' }).setToken(this.config.discordToken);
      try {
        await rest.put(
          Routes.applicationGuildCommands(this.client.application.id, this.config.discordGuildId),
          { body: slashCommands.map(cmd => cmd.toJSON()) }
        );
        this.log('Slash commands registered to guild');
      } catch (err) {
        this.log(`Failed to register slash commands: ${err.message}`);
      }

      if (!this.manualStop) {
        this.start('startup');
      }
    });

    this.client.on('error', err => {
      this.log(`Discord client error: ${err.message}`);
    });

    this.client.on('interactionCreate', async interaction => {
      if (!interaction.isChatInputCommand() || interaction.user.id !== this.config.allowedUserId) return;
      try {
        await interaction.deferReply({ ephemeral: true });
        const name = interaction.commandName;
        const reply = msg => interaction.editReply({ content: msg });

        if (name === `${this.config.commandPrefix}autostart`) {
          this.manualStop = !this.manualStop;
          this.saveState();
          if (!this.manualStop) {
            if (this.state === 'ONLINE') return reply('Autostart enabled; bot already running.');
            this.start('slash-autostart');
            return reply('Autostart enabled; starting bot...');
          } else {
            this.stop('manual');
            return reply('Autostart disabled; bot stopped.');
          }
        }

        if (name === `${this.config.commandPrefix}change`) {
          const mode = interaction.options.getString('mode');
          this.targetMode = mode;
          this.currentMode = mode;
          this.pendingModeSelection = true;
          this.manualStop = false;
          this.saveState();

          if (this.state === 'ONLINE') {
            this.mcBot.chat(`/${mode}`);
            return reply(`Switching to ${mode}...`);
          } else {
            this.start(`slash-change-${mode}`);
            return reply(`Starting bot targeting ${mode}...`);
          }
        }
        
        if (name === `${this.config.commandPrefix}relog`) {
          this.autoNavigate = !this.autoNavigate;
          return reply(`Auto-navigation is now ${this.autoNavigate ? 'ON' : 'OFF'}.`);
        }

        if (name === `${this.config.commandPrefix}online`) {
          if (this.state !== 'ONLINE' || !this.mcBot) {
            return reply('Bot is not currently connected to the server.');
          }

          const players = Object.values(this.mcBot.players || {});
          if (!players.length) {
            return reply('No players found in the player list.');
          }

          const totalOnline = players.length;
          const imageBuf = renderOnlinePlayersCanvas(players);
          const attachment = new AttachmentBuilder(imageBuf, { name: 'online-players.png' });

          const embed = new EmbedBuilder()
            .setTitle(`UltraNetwork — Online Players (${totalOnline})`)
            .setColor(0x5865F2)
            .setImage('attachment://online-players.png')
            .setFooter({ text: `Total Online: ${totalOnline} • mc.ultranetwork.net` })
            .setTimestamp();

          return interaction.editReply({
            embeds: [embed],
            files: [attachment]
          });
        }

        // Rest of the commands require the bot to be online
        if (this.state !== 'ONLINE' || !this.mcBot) {
          return reply('Bot is not currently fully connected.');
        }

        const window = this.mcBot.currentWindow ?? this.mcBot.inventory;
        const slot = interaction.options.getInteger('slot');

        if (name === `${this.config.commandPrefix}screen`) {
          const isContainer = Boolean(this.mcBot.currentWindow);
          const imageBuf = renderInventoryCanvas(window, isContainer);
          const attachment = new AttachmentBuilder(imageBuf, { name: 'screen.png' });

          const occupied = [];
          for (let i = 0; i < window.slots.length; i++) {
            const item = window.slots[i];
            if (item) {
              const displayName = getItemDisplayName(item);
              const emoji = getItemEmoji(item.name);
              occupied.push(`• **Slot ${i}:** ${item.count}x ${emoji} **${displayName}** (\`${item.name}\`)`);
            }
          }

          let summaryText = `📦 **Items in ${isContainer ? 'open GUI' : 'inventory'}:**\n`;
          if (!occupied.length) {
            summaryText += '*(No items found)*';
          } else {
            summaryText += occupied.slice(0, 20).join('\n');
            if (occupied.length > 20) {
              summaryText += `\n*(+${occupied.length - 20} more items)*`;
            }
          }

          return interaction.editReply({
            content: summaryText.slice(0, 1950),
            files: [attachment]
          });
        }

        if (name === `${this.config.commandPrefix}click`) {
          await this.mcBot.clickWindow(slot, 0, 0);
          return reply(`Clicked slot ${slot}.`);
        }

        if (name === `${this.config.commandPrefix}shiftclick`) {
          await this.mcBot.clickWindow(slot, 0, 1);
          return reply(`Shift-clicked slot ${slot}.`);
        }

        if (name === `${this.config.commandPrefix}rightclick`) {
          if (slot !== null && slot >= 0 && slot <= 8) this.mcBot.setQuickBarSlot(slot);
          await this.mcBot.activateItem();
          return reply(slot !== null ? `Right-clicked hotbar slot ${slot}.` : 'Right-clicked held item.');
        }

        if (name === `${this.config.commandPrefix}slot`) {
          if (slot < 0 || slot > 8) return reply('Slot must be 0-8.');
          this.mcBot.setQuickBarSlot(slot);
          return reply(`Selected hotbar slot ${slot}.`);
        }

        if (name === `${this.config.commandPrefix}select`) {
          const query = interaction.options.getString('item_id')?.toLowerCase();
          const match = window.slots.find(item => item && (item.name.toLowerCase().includes(query) || item.type.toString() === query));
          if (!match) return reply(`No item matching "${query}" found.`);
          await this.mcBot.clickWindow(match.slot, 0, 0);
          return reply(`Clicked ${match.count}x ${match.name} in slot ${match.slot}`);
        }
        
        if (name === `${this.config.commandPrefix}closegui`) {
          if (!this.mcBot.currentWindow) return reply('No GUI open.');
          this.mcBot.closeWindow(this.mcBot.currentWindow);
          return reply('GUI closed.');
        }

        if (name === `${this.config.commandPrefix}walk`) {
          const steps = interaction.options.getInteger('steps');
          const dir = this.mcBot.entity.yaw;
          const pos = this.mcBot.entity.position.offset(Math.sin(dir) * steps, 0, Math.cos(dir) * steps);
          this.mcBot.pathfinder?.setGoal(new GoalBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)));
          return reply(`Walking forward ${steps} blocks.`);
        }

        if (name === `${this.config.commandPrefix}move`) {
          const blocks = interaction.options.getInteger('blocks');
          const direction = interaction.options.getString('direction');
          const yaw = this.mcBot.entity.yaw;
          let pos;
          if (direction === 'north') pos = this.mcBot.entity.position.offset(0, 0, -blocks);
          else if (direction === 'south') pos = this.mcBot.entity.position.offset(0, 0, blocks);
          else if (direction === 'east') pos = this.mcBot.entity.position.offset(blocks, 0, 0);
          else if (direction === 'west') pos = this.mcBot.entity.position.offset(-blocks, 0, 0);
          else if (direction === 'forward') pos = this.mcBot.entity.position.offset(Math.sin(yaw) * blocks, 0, Math.cos(yaw) * blocks);
          else if (direction === 'backward') pos = this.mcBot.entity.position.offset(-Math.sin(yaw) * blocks, 0, -Math.cos(yaw) * blocks);
          else if (direction === 'left') pos = this.mcBot.entity.position.offset(Math.sin(yaw + Math.PI/2) * blocks, 0, Math.cos(yaw + Math.PI/2) * blocks);
          else if (direction === 'right') pos = this.mcBot.entity.position.offset(Math.sin(yaw - Math.PI/2) * blocks, 0, Math.cos(yaw - Math.PI/2) * blocks);
          
          this.mcBot.pathfinder?.setGoal(new GoalBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)));
          return reply(`Moving ${direction} by ${blocks} blocks.`);
        }
        
        if (name === `${this.config.commandPrefix}rotate`) {
          const yaw = interaction.options.getNumber('yaw');
          const pitch = interaction.options.getNumber('pitch');
          await this.mcBot.look(yaw, pitch, true);
          return reply(`Rotated to yaw: ${yaw}, pitch: ${pitch}.`);
        }

      } catch (err) {
        this.log(`Command error: ${err}`);
      }
    });

    this.client.on('messageCreate', async msg => {
      if (msg.author.bot) return;

      // Handle dedicated Terminal channel
      if (this.config.terminalChannelId && msg.channel.id === this.config.terminalChannelId) {
        if (msg.author.id !== this.config.allowedUserId) {
          this.log(`Terminal unauthorized attempt from ${msg.author.tag} (${msg.author.id})`);
          return;
        }
        this.log(`Terminal command received: "${msg.content}"`);
        await this.handleTerminalMessage(msg);
        return;
      }

      // Handle in-game chat relay
      if (!this.mcBot || this.state !== 'ONLINE' || msg.author.id !== this.config.allowedUserId || msg.channel.id !== this.config.discordChannelId) return;
      this.mcBot.chat(msg.content);
    });

    this.client.login(this.config.discordToken);
  }

  async handleTerminalMessage(msg) {
    const rawContent = msg.content.trim();
    if (!rawContent) return;

    // Strip codeblock wrappers if user typed ```bash ... ``` or `...`
    let command = rawContent;
    if (command.startsWith('```') && command.endsWith('```')) {
      command = command.slice(3, -3).trim();
      if (command.startsWith('bash\n') || command.startsWith('sh\n')) {
        command = command.slice(command.indexOf('\n') + 1).trim();
      }
    } else if (command.startsWith('`') && command.endsWith('`')) {
      command = command.slice(1, -1).trim();
    }

    if (!command) return;

    // Built-in cd command
    if (command.startsWith('cd ') || command === 'cd') {
      const targetDir = command === 'cd' ? (process.env.HOME || '/FTP/discordbot') : command.slice(3).trim();
      const resolved = path.resolve(this.terminalCwd, targetDir.replace(/^~/, process.env.HOME || '/home/bot'));
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        this.terminalCwd = resolved;
        return msg.reply(`📁 **Directory:** \`${this.terminalCwd}\``);
      } else {
        return msg.reply(`❌ Directory not found: \`${targetDir}\``);
      }
    }

    // Built-in pwd command
    if (command === 'pwd') {
      return msg.reply(`📁 **Current directory:** \`${this.terminalCwd}\``);
    }

    // Indicate typing indicator
    await msg.channel.sendTyping().catch(() => {});

    // Automatically inject password for sudo if needed
    let execCommand = command;
    if (/^\s*sudo\s+/i.test(command)) {
      execCommand = `echo '0123' | sudo -S ${command.replace(/^\s*sudo\s+/i, '')}`;
    }

    exec(execCommand, {
      cwd: this.terminalCwd,
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      shell: '/bin/bash'
    }, (err, stdout, stderr) => {
      let output = (stdout || '') + (stderr || '');
      output = output.replace(/\[sudo\] password for [^:]+:\s*/g, '').trim();

      if (!output) {
        if (err) {
          return msg.reply(`❌ Command failed: \`${err.message}\``);
        }
        return msg.reply('✅ Process exited with code 0 (no output).');
      }

      if (output.length <= 1900) {
        return msg.reply(`\`\`\`bash\n${output}\n\`\`\``);
      }

      // If output exceeds Discord message limit (2000 chars), attach as output.txt
      const buffer = Buffer.from(output, 'utf-8');
      const attachment = new AttachmentBuilder(buffer, { name: 'output.txt' });
      const preview = output.slice(0, 400);
      return msg.reply({
        content: `\`\`\`bash\n${preview}\n... (truncated, ${output.length} characters total)\n\`\`\``,
        files: [attachment]
      });
    });
  }

  setupWebSocket() {
    const wss = new WebSocket.Server({ port: this.config.wsPort }, () => {
      this.log(`WebSocket server running on port ${this.config.wsPort}`);
    });
    
    wss.on('error', err => {
      this.log(`WebSocket server error: ${err.message}`);
    });
    
    wss.on('connection', ws => {
      ws.on('error', err => {
        this.log(`WebSocket connection error: ${err.message}`);
      });
      
      ws.on('message', msg => {
        const cmd = msg.toString().trim();
        if (cmd === 'start') {
          this.manualStop = false;
          this.start('websocket-start');
          ws.send(this.state !== 'OFFLINE' ? 'starting_or_running' : 'start_failed');
        } else if (cmd === 'stop') {
          this.stop('manual');
          ws.send('stopped');
        } else if (this.state === 'ONLINE' && this.mcBot) {
          this.mcBot.chat(cmd);
          ws.send(`sent:${cmd}`);
        } else {
          ws.send('not_running');
        }
      });
    });
  }

  stop(reason = 'manual') {
    if (reason === 'manual') {
      this.manualStop = true;
      this.saveState();
    }
    this.log(`Stopping bot... (${reason})`);
    this.sendToDiscord(`Stopping bot... (${reason})`);
    
    this.state = 'OFFLINE';
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    
    this.modeClickInProgress = false;

    if (this.chatFlushTimer) {
      clearTimeout(this.chatFlushTimer);
      this.chatFlushTimer = null;
    }
    this.chatBuffer = [];

    if (this.mcBot) {
      const botToStop = this.mcBot;
      this.mcBot = null;

      // Keep dummy error handlers during teardown so socket drop errors are absorbed and cannot crash Node
      try {
        botToStop.removeAllListeners();
        botToStop.on('error', () => {});
        if (botToStop._client) {
          botToStop._client.removeAllListeners();
          botToStop._client.on('error', () => {});
          try { botToStop._client.socket?.destroy(); } catch (e) {}
          try { botToStop._client.end(); } catch (e) {}
        }
        try { botToStop.end(); } catch (e) {}
      } catch (e) {}
    }
  }

  start(reason = 'manual') {
    if (this.manualStop) {
      this.log(`Start skipped (${reason}): bot is manually stopped.`);
      return;
    }
    if (this.state === 'CONNECTING' || this.state === 'ONLINE') return;
    
    this.state = 'CONNECTING';
    this.log(`Starting bot (${reason})...`);
    this.sendToDiscord(`Starting bot (${reason})...`);
    
    this.mcBot = mineflayer.createBot({
      host: this.config.mcHost,
      port: 25565,
      username: this.config.mcUsername,
      auth: this.config.mcAuth,
      version: this.config.mcVersion,
      onMsaCode: (data) => {
        this.log(`MSA Code: ${data.user_code} (${data.verification_uri})`);
        this.sendToDiscord(`🔐 **Microsoft Authentication Required:**\nVisit: ${data.verification_uri}\nEnter code: \`${data.user_code}\``);
      }
    });

    // Unified disconnect and error handling registered immediately
    const onDisconnect = (event, reason) => {
      if (this.manualStop || this.state === 'OFFLINE') return;
      const reasonStr = normalizeReason(reason);
      this.log(`Disconnected (${event}): ${reasonStr}`);
      this.sendToDiscord(`Disconnected (${event}): ${reasonStr}`);
      this.handleDisconnect(reasonStr);
    };

    this.mcBot.on('end', r => onDisconnect('end', r));
    this.mcBot.on('kicked', r => onDisconnect('kicked', r));
    this.mcBot.on('error', err => onDisconnect('error', err?.message));

    this.mcBot.loadPlugin(pathfinder);

    this.mcBot.once('connect', () => {
      this.log('TCP connected.');
    });

    this.mcBot.once('spawn', async () => {
      this.state = 'ONLINE';
      this.reconnectAttempts = 0;
      this.log('Bot spawned in-game.');
      this.sendToDiscord('Bot spawned in-game.');
      
      try {
        const mcData = require('minecraft-data')(this.mcBot.version);
        const defaultMovements = new Movements(this.mcBot, mcData);
        defaultMovements.canDig = false;
        defaultMovements.scafoldingBlocks = [];
        this.mcBot.pathfinder.setMovements(defaultMovements);
      } catch (err) {}

      // Handle auto-navigation to requested gamemode
      if (this.autoNavigate && this.targetMode) {
        this.navigateWithCompass(this.targetMode);
      }
    });

    this.mcBot.on('message', async (jsonMsg) => {
      let fullMessage = '';
      if (jsonMsg.unsigned) fullMessage = flattenComponent(jsonMsg.unsigned).trim();
      else if (jsonMsg.json) fullMessage = flattenComponent(jsonMsg.json).trim();
      else fullMessage = jsonMsg.toString().trim();
      
      if (!fullMessage) return;
      
      const t = fullMessage.toLowerCase();
      if (t.includes('you have started auto mining') || t.includes('you were sent back to auto mining') || t.includes('+ 466p')) {
        this.currentMode = 'prison';
        this.targetMode = 'prison';
        this.pendingModeSelection = false;
      }
      if (t.includes('connecting to survival') || t.includes('selected survival')) {
        this.currentMode = 'survival';
        this.targetMode = 'survival';
        this.pendingModeSelection = false;
      }
      
      this.queueMessage(fullMessage);
    });
  }

  handleDisconnect(reasonStr) {
    if (this.manualStop || this.state === 'OFFLINE') {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      return;
    }
    
    if (reasonStr.includes('failed to obtain profile data') || reasonStr.includes('does the account own minecraft')) {
      this.log('Authentication failed. Stopping reconnect loop.');
      this.sendToDiscord('Authentication failed: Microsoft account profile could not be verified. Autostart stopped.');
      this.stop('manual');
      return;
    }

    this.stop('reconnecting');
    this.state = 'RECONNECTING';
    
    // Calculate exponential backoff
    let delayMs = 15000 + (this.reconnectAttempts * 10000);
    
    if (reasonStr.includes('you are already connected to this proxy')) {
      // Heavy exponential backoff for proxy ghost sessions
      delayMs = Math.min(45000 + (this.reconnectAttempts * 45000), 300000);
    } else if (reasonStr.includes('socketclosed') || reasonStr.includes('timeout')) {
      delayMs = Math.min(30000 + (this.reconnectAttempts * 15000), 90000);
    }
    
    this.reconnectAttempts++;
    this.log(`Scheduling reconnect #${this.reconnectAttempts} in ${delayMs / 1000}s...`);
    this.sendToDiscord(`Reconnecting in ${delayMs / 1000}s...`);
    
    this.reconnectTimer = setTimeout(() => {
      this.start('auto-reconnect');
    }, delayMs);
  }

  async navigateWithCompass(targetMode) {
    if (this.state !== 'ONLINE' || !this.mcBot || this.modeClickInProgress) return;
    this.modeClickInProgress = true;
    
    this.log(`Auto-navigating to ${targetMode}...`);
    this.sendToDiscord(`Auto-navigating to ${targetMode}...`);
    
    // Find compass in hotbar (slots 36-44)
    const compass = this.mcBot.inventory.slots.slice(36, 45).find(i => i && i.name && i.name.includes('compass'));
    if (!compass) {
      this.log('No compass found in hotbar.');
      this.modeClickInProgress = false;
      return;
    }
    
    const hotbarSlot = compass.slot - 36;
    this.mcBot.setQuickBarSlot(hotbarSlot);
    await delay(1000);
    
    const onWindowOpen = async (window) => {
      this.mcBot.removeListener('windowOpen', onWindowOpen);
      await delay(2500); // Wait for GUI to populate
      
      if (this.state !== 'ONLINE') return;
      const targetItemName = targetMode === 'survival' ? 'grass_block' : 'netherite_pickaxe';
      const targetItem = window.slots.find(i => i && i.name === targetItemName);
      
      if (targetItem) {
        try {
          await this.mcBot.clickWindow(targetItem.slot, 0, 0);
          this.log(`Successfully clicked ${targetItemName} for ${targetMode}.`);
          this.sendToDiscord(`Successfully clicked ${targetItemName} for ${targetMode}.`);
          this.pendingModeSelection = false;
        } catch (e) {
          this.log(`Failed to click ${targetItemName}: ${e.message}`);
        }
      } else {
        this.log(`Could not find ${targetItemName} in GUI.`);
      }
      this.modeClickInProgress = false;
    };
    
    this.mcBot.once('windowOpen', onWindowOpen);
    
    try {
      await this.mcBot.activateItem();
    } catch (e) {
      this.log(`Failed to activate compass: ${e.message}`);
      this.modeClickInProgress = false;
    }
  }
}

module.exports = { DiscordMCBot };
