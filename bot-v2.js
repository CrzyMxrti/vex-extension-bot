// ═══════════════════════════════════════════════════════════════
// VEX EXTENSION - Discord Alert Bot v2.1
// Con verificación de servidor MC, setup único, y comandos admin
// ═══════════════════════════════════════════════════════════════

const { 
  Client, 
  GatewayIntentBits, 
  PermissionFlagsBits, 
  ChannelType, 
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const mcUtil = require('minecraft-server-util');
const http = require('http');

// ═══════════════════════════════════════════════════════════════
// SERVIDOR HTTP PARA MANTENER ACTIVO EN RENDER
// ═══════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>🤖 VEX EXTENSION Bot Activo!</h1><p>El bot está funcionando correctamente.</p>');
}).listen(PORT, () => {
  console.log(`🌐 Servidor HTTP activo en puerto ${PORT}`);
});

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════
const CONFIG_FILE = path.join(__dirname, 'config.json');
const SERVERS_FILE = path.join(__dirname, 'servers.json');

const DEFAULT_CONFIG = {
  token: process.env.DISCORD_TOKEN || '',
  alertChannelName: '🚨│vex-alerts'
};

let config = { ...DEFAULT_CONFIG };
let serversConfig = {}; 

// Servidor activo para comandos de consola
let activeGuildId = null;

// Cargar configuración principal
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    } else {
      saveConfig();
    }
  } catch (e) {
    console.error('❌ Error cargando config:', e.message);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('❌ Error guardando config:', e.message);
  }
}

function loadServersConfig() {
  try {
    if (fs.existsSync(SERVERS_FILE)) {
      serversConfig = JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'));
    } else {
      saveServersConfig();
    }
  } catch (e) {
    console.error('❌ Error cargando servers config:', e.message);
  }
}

function saveServersConfig() {
  try {
    fs.writeFileSync(SERVERS_FILE, JSON.stringify(serversConfig, null, 2));
  } catch (e) {
    console.error('❌ Error guardando servers config:', e.message);
  }
}

function getServerConfig(guildId) {
  if (!serversConfig[guildId]) {
    serversConfig[guildId] = {
      alertChannelId: null,
      setupMessageId: null,
      mcServerIp: null,
      mcServerPort: 19132,
      isSetup: false
    };
    saveServersConfig();
  }
  return serversConfig[guildId];
}

loadConfig();
loadServersConfig();

// ═══════════════════════════════════════════════════════════════
// CLIENTE DE DISCORD
// ═══════════════════════════════════════════════════════════════
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ═══════════════════════════════════════════════════════════════
// VERIFICACIÓN DE SERVIDOR MINECRAFT
// ═══════════════════════════════════════════════════════════════

async function checkMinecraftServer(ip, port = 19132) {
  try {
    const response = await mcUtil.statusBedrock(ip, port, { timeout: 5000 });
    return {
      online: true,
      edition: 'Bedrock',
      version: response.version?.name || 'Unknown',
      players: {
        online: response.players?.online || 0,
        max: response.players?.max || 0
      },
      motd: response.motd?.clean || 'Sin MOTD',
      playerList: response.players?.sample || []
    };
  } catch (bedrockError) {
    try {
      const response = await mcUtil.status(ip, port, { timeout: 5000 });
      return {
        online: true,
        edition: 'Java',
        version: response.version?.name || 'Unknown',
        players: {
          online: response.players?.online || 0,
          max: response.players?.max || 0
        },
        motd: response.motd?.clean || 'Sin MOTD',
        playerList: response.players?.sample || []
      };
    } catch (javaError) {
      return { online: false, error: 'Servidor no encontrado o apagado' };
    }
  }
}

async function verifyActiveServer() {
  if (!activeGuildId) {
    console.log('❌ No hay servidor seleccionado. Usa "use <número>" primero.');
    return null;
  }
  const conf = getServerConfig(activeGuildId);
  if (!conf.isSetup || !conf.mcServerIp) {
    console.log('❌ El servidor seleccionado no tiene configurado su servidor de Minecraft.');
    return null;
  }
  const status = await checkMinecraftServer(conf.mcServerIp, conf.mcServerPort);
  if (!status.online) {
    console.log(`❌ El servidor MC está OFFLINE: ${conf.mcServerIp}:${conf.mcServerPort}`);
    return null;
  }
  return { conf, status };
}

// ═══════════════════════════════════════════════════════════════
// FUNCIONES DEL BOT
// ═══════════════════════════════════════════════════════════════

async function createAlertChannel(guild) {
  const serverConf = getServerConfig(guild.id);
  
  if (serverConf.alertChannelId) {
    try {
      const existingChannel = await guild.channels.fetch(serverConf.alertChannelId);
      if (existingChannel) return existingChannel;
    } catch (e) {
      serverConf.alertChannelId = null;
      serverConf.setupMessageId = null;
    }
  }

  try {
    const channel = await guild.channels.create({
      name: config.alertChannelName,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions],
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
        },
        {
          id: client.user.id,
          allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
        }
      ],
      topic: '🔒 Canal de alertas de VEX EXTENSION - Solo lectura'
    });

    serverConf.alertChannelId = channel.id;
    serverConf.setupMessageId = null;
    saveServersConfig();
    console.log(`✅ Canal creado en ${guild.name}: #${channel.name}`);
    return channel;
  } catch (e) {
    console.error(`❌ Error creando canal en ${guild.name}:`, e.message);
    return null;
  }
}

async function sendSetupForm(channel, guild, force = false) {
  const serverConf = getServerConfig(guild.id);
  
  // NO enviar duplicados
  if (serverConf.setupMessageId && !force) {
    try {
      const existingMsg = await channel.messages.fetch(serverConf.setupMessageId);
      if (existingMsg) {
        console.log(`⏭️ Setup ya existe en ${guild.name}, no se envía duplicado`);
        return existingMsg;
      }
    } catch (e) {
      serverConf.setupMessageId = null;
    }
  }
  
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('⚙️ VEX EXTENSION - Configuración Inicial')
    .setDescription(
      '**¡Bienvenido al sistema de alertas de VEX EXTENSION!**\n\n' +
      'Para activar las alertas, necesito la información de tu servidor de Minecraft Bedrock.\n\n' +
      '📋 **Información requerida:**\n' +
      '• IP del servidor (ej: `play.miservidor.com` o `192.168.1.100`)\n' +
      '• Puerto (default: `19132`)\n\n' +
      '⚠️ **Solo administradores pueden configurar esto.**\n\n' +
      '💡 *Si aparece "Interacción fallida", espera a que el bot esté activo en Discord.*'
    )
    .setFooter({ text: 'VEX EXTENSION v6.0.0' })
    .setTimestamp();

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('setup_mc_server')
        .setLabel('⚙️ Configurar Servidor')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('check_mc_status')
        .setLabel('🔍 Verificar Estado')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!serverConf.mcServerIp)
    );

  if (serverConf.mcServerIp) {
    embed.addFields({
      name: serverConf.isSetup ? '✅ Servidor Configurado' : '⏳ Pendiente de verificación',
      value: `\`${serverConf.mcServerIp}:${serverConf.mcServerPort}\``,
      inline: true
    });
  }

  try {
    const msg = await channel.send({ embeds: [embed], components: [row] });
    serverConf.setupMessageId = msg.id;
    saveServersConfig();
    return msg;
  } catch (e) {
    console.error(`❌ Error enviando setup:`, e.message);
    return null;
  }
}

async function sendHackAlert(guildId, playerName, reason, extra = {}) {
  const serverConf = getServerConfig(guildId);
  if (!serverConf.isSetup || !serverConf.alertChannelId) return false;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return false;

  let alertChannel;
  try {
    alertChannel = await guild.channels.fetch(serverConf.alertChannelId);
  } catch (e) {
    return false;
  }

  const embed = new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle('⚠️ HACK DETECTADO')
    .addFields(
      { name: '👤 Jugador', value: `\`${playerName}\``, inline: true },
      { name: '🚨 Detección', value: reason, inline: true },
      { name: '🖥️ Servidor', value: `\`${serverConf.mcServerIp}:${serverConf.mcServerPort}\``, inline: true }
    )
    .setTimestamp();

  if (extra.action) embed.addFields({ name: '⚡ Acción', value: extra.action, inline: true });
  if (extra.details) embed.addFields({ name: '📋 Detalles', value: extra.details, inline: false });

  try {
    await alertChannel.send({ embeds: [embed] });
    console.log(`✅ Alerta enviada a ${guild.name}: ${playerName} - ${reason}`);
    return true;
  } catch (e) {
    return false;
  }
}

async function sendActionNotification(guildId, action, playerName, reason, duration = null) {
  const serverConf = getServerConfig(guildId);
  if (!serverConf.isSetup || !serverConf.alertChannelId) return false;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return false;

  let alertChannel;
  try {
    alertChannel = await guild.channels.fetch(serverConf.alertChannelId);
  } catch (e) {
    return false;
  }

  const colors = { 'BAN': 0xFF0000, 'UNBAN': 0x00FF00, 'KICK': 0xFFA500, 'WARN': 0xFFFF00, 'MUTE': 0x9B59B6 };
  const icons = { 'BAN': '🔨', 'UNBAN': '✅', 'KICK': '🚪', 'WARN': '⚠️', 'MUTE': '🔇' };

  const embed = new EmbedBuilder()
    .setColor(colors[action] || 0x808080)
    .setTitle(`${icons[action] || '📋'} ${action}`)
    .addFields(
      { name: '👤 Jugador', value: `\`${playerName}\``, inline: true },
      { name: '📋 Razón', value: reason || 'Sin razón', inline: true }
    )
    .setTimestamp();

  if (duration) embed.addFields({ name: '⏱️ Duración', value: duration, inline: true });

  try {
    await alertChannel.send({ embeds: [embed] });
    return true;
  } catch (e) {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// EVENTOS
// ═══════════════════════════════════════════════════════════════

client.once('ready', async () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  🤖 Bot conectado como: ${client.user.tag}`);
  console.log(`  🔗 Client ID: ${client.user.id}`);
  console.log(`  📊 Servidores: ${client.guilds.cache.size}`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('📎 URL de invitación:');
  console.log(`https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`);
  console.log('');

  // Registrar slash commands
  const commands = [
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Mostrar el panel de configuración de VEX EXTENSION')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Slash command /setup registrado');
  } catch (e) {
    console.error('❌ Error registrando commands:', e.message);
  }

  console.log('🔧 Verificando canales...');
  
  for (const [guildId, guild] of client.guilds.cache) {
    const channel = await createAlertChannel(guild);
    const serverConf = getServerConfig(guildId);
    
    if (channel && !serverConf.isSetup) {
      await sendSetupForm(channel, guild); // NO forzar, evita duplicados
    }
  }

  const configuredGuilds = [...client.guilds.cache.entries()].filter(([id]) => serversConfig[id]?.isSetup);
  
  if (configuredGuilds.length > 0) {
    activeGuildId = configuredGuilds[0][0];
    console.log(`\n📍 Servidor activo: ${configuredGuilds[0][1].name}`);
  } else if (client.guilds.cache.size > 0) {
    activeGuildId = client.guilds.cache.first().id;
    console.log(`\n📍 Servidor activo: ${client.guilds.cache.first().name} (sin configurar)`);
  }

  console.log('\n✅ Listo! Escribe "help" para ver comandos.\n');
  startConsole();
});

client.on(Events.InteractionCreate, async (interaction) => {
  const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
  
  // Slash command /setup
  if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
    if (!isAdmin) {
      return interaction.reply({ content: '❌ Solo administradores pueden usar este comando.', ephemeral: true });
    }

    const serverConf = getServerConfig(interaction.guild.id);
    
    // Verificar o crear canal
    let channel;
    if (serverConf.alertChannelId) {
      try {
        channel = await interaction.guild.channels.fetch(serverConf.alertChannelId);
      } catch (e) {
        channel = null;
      }
    }
    
    if (!channel) {
      channel = await createAlertChannel(interaction.guild);
    }
    
    if (channel) {
      await sendSetupForm(channel, interaction.guild, true); // force = true
      return interaction.reply({ 
        content: `✅ Panel de configuración enviado a ${channel}`, 
        ephemeral: true 
      });
    } else {
      return interaction.reply({ 
        content: '❌ Error: No se pudo crear el canal de alertas.', 
        ephemeral: true 
      });
    }
  }
  
  if (interaction.isButton() && interaction.customId === 'setup_mc_server') {
    if (!isAdmin) {
      return interaction.reply({ content: '❌ Solo administradores pueden configurar.', ephemeral: true });
    }

    const serverConf = getServerConfig(interaction.guild.id);
    const modal = new ModalBuilder().setCustomId('mc_server_modal').setTitle('Configurar Servidor MC');

    const ipInput = new TextInputBuilder()
      .setCustomId('mc_ip')
      .setLabel('IP del servidor')
      .setPlaceholder('play.miservidor.com')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue(serverConf.mcServerIp || '');

    const portInput = new TextInputBuilder()
      .setCustomId('mc_port')
      .setLabel('Puerto (default: 19132)')
      .setPlaceholder('19132')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setValue(serverConf.mcServerPort?.toString() || '19132');

    modal.addComponents(
      new ActionRowBuilder().addComponents(ipInput),
      new ActionRowBuilder().addComponents(portInput)
    );

    await interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'check_mc_status') {
    const serverConf = getServerConfig(interaction.guild.id);
    if (!serverConf.mcServerIp) {
      return interaction.reply({ content: '❌ Primero configura el servidor.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const status = await checkMinecraftServer(serverConf.mcServerIp, serverConf.mcServerPort);

    if (status.online) {
      if (!serverConf.isSetup) {
        serverConf.isSetup = true;
        saveServersConfig();
        
        const activationEmbed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('✅ Sistema de Alertas Activado')
          .setDescription(`Servidor \`${serverConf.mcServerIp}:${serverConf.mcServerPort}\` online.\n\n🔔 Alertas activas.`)
          .setTimestamp();
        
        try {
          const ch = await interaction.guild.channels.fetch(serverConf.alertChannelId);
          await ch.send({ embeds: [activationEmbed] });
        } catch (e) {}
      }

      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ Servidor Online')
        .addFields(
          { name: '🎮 Edición', value: status.edition, inline: true },
          { name: '📦 Versión', value: status.version, inline: true },
          { name: '👥 Jugadores', value: `${status.players.online}/${status.players.max}`, inline: true }
        );
      
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.editReply({ content: `❌ **Servidor Offline**\n\`${serverConf.mcServerIp}:${serverConf.mcServerPort}\`` });
    }
  }

  if (interaction.isModalSubmit() && interaction.customId === 'mc_server_modal') {
    const ip = interaction.fields.getTextInputValue('mc_ip').trim();
    const port = parseInt(interaction.fields.getTextInputValue('mc_port')) || 19132;

    await interaction.deferReply({ ephemeral: true });
    console.log(`🔍 Verificando servidor: ${ip}:${port}...`);
    const status = await checkMinecraftServer(ip, port);
    const serverConf = getServerConfig(interaction.guild.id);

    if (status.online) {
      serverConf.mcServerIp = ip;
      serverConf.mcServerPort = port;
      serverConf.isSetup = true;
      saveServersConfig();

      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('✅ Servidor Configurado')
        .setDescription('¡Alertas activadas!')
        .addFields(
          { name: '🖥️ Servidor', value: `\`${ip}:${port}\``, inline: true },
          { name: '🎮 Edición', value: status.edition, inline: true },
          { name: '👥 Jugadores', value: `${status.players.online}/${status.players.max}`, inline: true }
        );

      await interaction.editReply({ embeds: [embed] });

      try {
        const alertChannel = await interaction.guild.channels.fetch(serverConf.alertChannelId);
        const successEmbed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('✅ Sistema de Alertas Activo')
          .setDescription(`**Servidor:** \`${ip}:${port}\`\n**Edición:** ${status.edition}\n\n🔔 Las alertas se mostrarán aquí.`)
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('setup_mc_server').setLabel('⚙️ Reconfigurar').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('check_mc_status').setLabel('🔍 Estado').setStyle(ButtonStyle.Primary)
        );

        await alertChannel.send({ embeds: [successEmbed], components: [row] });
      } catch (e) {}

      console.log(`✅ Configurado ${interaction.guild.name}: ${ip}:${port}`);
    } else {
      serverConf.mcServerIp = ip;
      serverConf.mcServerPort = port;
      serverConf.isSetup = false;
      saveServersConfig();

      await interaction.editReply({ 
        content: `❌ **Servidor Offline**\n\`${ip}:${port}\`\n\n💡 Guardado. Usa "🔍 Verificar Estado" cuando esté online.`
      });
    }
  }
});

client.on('channelDelete', async (channel) => {
  for (const [guildId, conf] of Object.entries(serversConfig)) {
    if (conf.alertChannelId === channel.id) {
      console.log(`⚠️ Canal eliminado, recreando...`);
      conf.alertChannelId = null;
      conf.setupMessageId = null; // Reset para que se envíe nuevo mensaje
      saveServersConfig();
      
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const newChannel = await createAlertChannel(guild);
        if (newChannel) {
          // SIEMPRE enviar el setup al recrear canal
          await sendSetupForm(newChannel, guild);
          console.log(`📝 Setup enviado al canal recreado en ${guild.name}`);
        }
      }
    }
  }
});

client.on('guildCreate', async (guild) => {
  console.log(`📥 Bot añadido a: ${guild.name}`);
  const channel = await createAlertChannel(guild);
  if (channel) await sendSetupForm(channel, guild);
});

// ═══════════════════════════════════════════════════════════════
// CONSOLA
// ═══════════════════════════════════════════════════════════════

function startConsole() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const getPrompt = () => {
    if (activeGuildId) {
      const guild = client.guilds.cache.get(activeGuildId);
      const conf = serversConfig[activeGuildId];
      const status = conf?.isSetup ? '✅' : '⏳';
      return `\x1b[36m[${status}${guild?.name || '?'}]>\x1b[0m `;
    }
    return '\x1b[36mVEX>\x1b[0m ';
  };

  const prompt = () => {
    rl.question(getPrompt(), async (input) => {
      const [command, ...args] = input.trim().split(' ');

      switch (command.toLowerCase()) {
        case 'help':
          console.log(`
═══════════════════════════════════════════════════════════════
  📋 COMANDOS
═══════════════════════════════════════════════════════════════
  help            - Ayuda
  status          - Estado del bot
  servers         - Lista servidores
  use <n>         - Seleccionar servidor
  
  🎮 MINECRAFT:
  mc              - Info servidor MC
  mcstatus [ip]   - Verificar servidor
  
  📨 ALERTAS (requiere config + MC online):
  alert <player> <reason>   - Enviar alerta hack
  alertall <player> <reason>- A todos los servers
  
  ⚡ ACCIONES:
  ban <player> <reason>     kick <player> [reason]
  unban <player>            warn <player> <reason>
  mute <player> <duration>
  
  ⚙️ ADMIN:
  setup           - Reenviar formulario
  resetsetup      - Resetear config
  exit            - Cerrar
═══════════════════════════════════════════════════════════════`);
          break;

        case 'status':
          console.log(`\n  🤖 ${client.user?.tag}\n  📊 Servidores: ${client.guilds.cache.size}\n  ✅ Configurados: ${Object.values(serversConfig).filter(s => s.isSetup).length}\n`);
          break;

        case 'servers':
          console.log('\n📋 Servidores:\n');
          let i = 1;
          for (const [guildId, guild] of client.guilds.cache) {
            const conf = getServerConfig(guildId);
            const active = guildId === activeGuildId ? ' ← ACTIVO' : '';
            const status = conf.isSetup ? '✅' : '⏳';
            console.log(`  ${i}. ${status} ${guild.name}${active}`);
            console.log(`     MC: ${conf.mcServerIp ? `${conf.mcServerIp}:${conf.mcServerPort}` : 'No configurado'}`);
            i++;
          }
          console.log('\n💡 Usa "use <número>" para seleccionar\n');
          break;

        case 'use':
          if (!args[0]) { console.log('❌ Uso: use <número>'); break; }
          const num = parseInt(args[0]);
          const arr = [...client.guilds.cache.entries()];
          if (num < 1 || num > arr.length) { console.log('❌ Número inválido'); break; }
          activeGuildId = arr[num - 1][0];
          const sel = getServerConfig(activeGuildId);
          console.log(`✅ Servidor: ${arr[num - 1][1].name}`);
          if (sel.isSetup) console.log(`   MC: ${sel.mcServerIp}:${sel.mcServerPort}`);
          else console.log('   ⚠️ Sin configurar');
          break;

        case 'mc':
          if (!activeGuildId) { console.log('❌ Usa "use <n>" primero'); break; }
          const mcConf = getServerConfig(activeGuildId);
          if (!mcConf.mcServerIp) { console.log('❌ Sin servidor MC configurado'); break; }
          console.log(`\n🎮 MC: ${mcConf.mcServerIp}:${mcConf.mcServerPort}`);
          const mcInfo = await checkMinecraftServer(mcConf.mcServerIp, mcConf.mcServerPort);
          if (mcInfo.online) console.log(`   ✅ Online - ${mcInfo.edition} ${mcInfo.version}\n   👥 ${mcInfo.players.online}/${mcInfo.players.max}`);
          else console.log('   ❌ Offline');
          console.log('');
          break;

        case 'mcstatus':
          const ip = args[0] || (activeGuildId ? getServerConfig(activeGuildId).mcServerIp : null);
          const port = parseInt(args[1]) || 19132;
          if (!ip) { console.log('❌ Uso: mcstatus <ip> [port]'); break; }
          console.log(`🔍 Verificando ${ip}:${port}...`);
          const st = await checkMinecraftServer(ip, port);
          if (st.online) console.log(`  ✅ Online - ${st.edition} ${st.version}\n  👥 ${st.players.online}/${st.players.max}`);
          else console.log('  ❌ Offline');
          break;

        case 'alert':
          if (args.length < 2) { console.log('❌ Uso: alert <player> <reason>'); break; }
          const v = await verifyActiveServer();
          if (!v) break;
          await sendHackAlert(activeGuildId, args[0], args.slice(1).join(' '));
          break;

        case 'alertall':
          if (args.length < 2) { console.log('❌ Uso: alertall <player> <reason>'); break; }
          let cnt = 0;
          for (const [gId] of client.guilds.cache) {
            if (getServerConfig(gId).isSetup) {
              if (await sendHackAlert(gId, args[0], args.slice(1).join(' '))) cnt++;
            }
          }
          console.log(`📤 Enviado a ${cnt} servidores`);
          break;

        case 'ban':
          if (args.length < 2) { console.log('❌ Uso: ban <player> <reason>'); break; }
          if (!activeGuildId || !getServerConfig(activeGuildId).isSetup) { console.log('❌ Servidor no configurado'); break; }
          await sendActionNotification(activeGuildId, 'BAN', args[0], args.slice(1).join(' '));
          console.log(`✅ BAN enviado: ${args[0]}`);
          break;

        case 'unban':
          if (!args[0]) { console.log('❌ Uso: unban <player>'); break; }
          if (!activeGuildId || !getServerConfig(activeGuildId).isSetup) { console.log('❌ Servidor no configurado'); break; }
          await sendActionNotification(activeGuildId, 'UNBAN', args[0], 'Desbaneado');
          console.log(`✅ UNBAN enviado: ${args[0]}`);
          break;

        case 'kick':
          if (!args[0]) { console.log('❌ Uso: kick <player> [reason]'); break; }
          if (!activeGuildId || !getServerConfig(activeGuildId).isSetup) { console.log('❌ Servidor no configurado'); break; }
          await sendActionNotification(activeGuildId, 'KICK', args[0], args.slice(1).join(' ') || 'Expulsado');
          console.log(`✅ KICK enviado: ${args[0]}`);
          break;

        case 'warn':
          if (args.length < 2) { console.log('❌ Uso: warn <player> <reason>'); break; }
          if (!activeGuildId || !getServerConfig(activeGuildId).isSetup) { console.log('❌ Servidor no configurado'); break; }
          await sendActionNotification(activeGuildId, 'WARN', args[0], args.slice(1).join(' '));
          console.log(`✅ WARN enviado: ${args[0]}`);
          break;

        case 'mute':
          if (args.length < 2) { console.log('❌ Uso: mute <player> <duration>'); break; }
          if (!activeGuildId || !getServerConfig(activeGuildId).isSetup) { console.log('❌ Servidor no configurado'); break; }
          await sendActionNotification(activeGuildId, 'MUTE', args[0], 'Silenciado', args.slice(1).join(' '));
          console.log(`✅ MUTE enviado: ${args[0]}`);
          break;

        case 'setup':
          if (!activeGuildId) { console.log('❌ Usa "use <n>" primero'); break; }
          const sg = client.guilds.cache.get(activeGuildId);
          const sc = getServerConfig(activeGuildId);
          if (sc.alertChannelId) {
            try {
              const ch = await sg.channels.fetch(sc.alertChannelId);
              await sendSetupForm(ch, sg, true);
              console.log('✅ Setup reenviado');
            } catch (e) { console.log('❌ Canal no encontrado'); }
          } else {
            const nc = await createAlertChannel(sg);
            if (nc) { await sendSetupForm(nc, sg, true); console.log('✅ Canal creado y setup enviado'); }
          }
          break;

        case 'resetsetup':
          if (!activeGuildId) { console.log('❌ Usa "use <n>" primero'); break; }
          const rc = getServerConfig(activeGuildId);
          rc.isSetup = false;
          rc.mcServerIp = null;
          rc.mcServerPort = 19132;
          rc.setupMessageId = null;
          saveServersConfig();
          console.log('✅ Reseteado. Usa "setup" para reenviar formulario.');
          break;

        case 'exit': case 'quit':
          console.log('👋 Cerrando...');
          client.destroy();
          process.exit(0);
          break;

        case '': break;
        default: console.log(`❌ Comando desconocido. Usa "help".`);
      }

      prompt();
    });
  };

  prompt();
}

// ═══════════════════════════════════════════════════════════════
// INICIAR
// ═══════════════════════════════════════════════════════════════

// Capturar errores globales
process.on('unhandledRejection', (error) => {
  console.error('❌ Error no manejado:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Excepción no capturada:', error);
});

// Limpiar token (por si tiene espacios)
const cleanToken = config.token.trim();

if (!cleanToken || cleanToken === 'TU_TOKEN_AQUI' || cleanToken === '') {
  console.log('\n⚠️ ERROR: Token no configurado!');
  console.log('Configura DISCORD_TOKEN en las variables de entorno de Render\n');
} else {
  console.log('🔄 Conectando...');
  // Mostrar más del token para verificar que cambió
  console.log('Token hash:', cleanToken.substring(0,20) + '...' + cleanToken.substring(cleanToken.length-10));
  console.log('Longitud del token:', cleanToken.length);
  
  // Test de conectividad básica a Discord
  const https = require('https');
  https.get('https://discord.com/api/v10/gateway', (res) => {
    console.log('✅ Conectividad con Discord API: OK (status ' + res.statusCode + ')');
  }).on('error', (e) => {
    console.log('❌ Error de conectividad con Discord:', e.message);
  });
  
  // Timeout para detectar si el login se cuelga
  const loginTimeout = setTimeout(() => {
    console.log('⚠️ Login está tardando más de 10 segundos...');
    console.log('Posibles causas: token inválido, problemas de red, o intents no habilitados');
  }, 10000);

  client.login(cleanToken)
    .then(() => {
      clearTimeout(loginTimeout);
      console.log('✅ Login exitoso, esperando evento ready...');
    })
    .catch((e) => {
      clearTimeout(loginTimeout);
      console.error('❌ Error de login:', e.message);
      console.error('Código:', e.code);
    });
}
