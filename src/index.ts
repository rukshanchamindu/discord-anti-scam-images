import { Client, IntentsBitField } from 'discord.js';
import ms from 'ms';
import type { StringValue } from 'ms';
import { MessageAnalyzer } from "./analyzeMessage.ts";
import { SpamManager } from "./services/SpamManager.ts";
import 'dotenv/config';

async function init() {
    // Get bot configs strictly from BOTS (JSON)
    if (!process.env.BOTS) {
        throw new Error("Missing BOTS environment variable. Please provide a JSON array of bot configurations.");
    }

    let botConfigs: { 
        token: string, 
        logChannel?: string, 
        enabled?: boolean,
        allowedChannels?: string[],
        disallowedChannels?: string[],
        isWhitelist?: boolean
    }[] = [];

    try {
        botConfigs = JSON.parse(process.env.BOTS);
    } catch (err) {
        throw new Error(`Failed to parse BOTS environment variable as JSON: ${err}`);
    }

    // Filter for enabled bots only
    const activeConfigs = botConfigs.filter(b => b.enabled !== false && b.token);

    const BANNED_WORDS = process.env.BANNED_WORDS?.split(",") || ["crypto casino", "special promo code"];
    const SHOULD_DELETE = process.env.SHOULD_DELETE !== "false";
    const SHOULD_PUNISH = process.env.SHOULD_PUNISH !== "false";
    const TIMEOUT_DURATION = ms((process.env.TIMEOUT_DURATION || "7d") as StringValue);
    const SCAN_EVERYTHING = process.env.SCAN_EVERYTHING !== "false";
    const TRIGGERS_BEFORE_ACTION = parseInt(process.env.TRIGGERS_BEFORE_ACTION || "1");
    const MASS_ANALYZER_DELAY = parseInt(process.env.MASS_ANALYZER_DELAY || "2000");
    const DEBUG = process.env.DEBUG === "true";

    if (activeConfigs.length === 0) {
        throw new Error("No enabled bot configurations found.");
    }

    const messageAnalyzer = new MessageAnalyzer(BANNED_WORDS, DEBUG);
    await messageAnalyzer.initializeWorker();

    const clients: Client[] = [];

    for (const config of activeConfigs) {
        // Use bot-specific config or default to empty/false
        const allowedChannels = config.allowedChannels || [];
        const disallowedChannels = config.disallowedChannels || [];
        const isWhitelist = config.isWhitelist || false;

        const bot = new Client({
            intents: [IntentsBitField.Flags.MessageContent, IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMessages]
        });

        const spamManager = new SpamManager(bot, messageAnalyzer, {
            debug: DEBUG,
            shouldDelete: SHOULD_DELETE,
            shouldPunish: SHOULD_PUNISH,
            timeoutDuration: TIMEOUT_DURATION,
            triggersBeforeAction: TRIGGERS_BEFORE_ACTION,
            massAnalyzerDelay: MASS_ANALYZER_DELAY,
            logChannelId: config.logChannel || ""
        });

        bot.on("clientReady", () => {
            console.log(`[Bot Ready] Logged in as ${bot.user?.tag}!`);
        });

        bot.on("messageCreate", async (message) => {
            if (message.author.id === bot.user?.id) return;

            // Channel filters (using bot-specific or merged config)
            if (isWhitelist) {
                if (!allowedChannels.includes(message.channel.id)) return;
            } else if (disallowedChannels.includes(message.channel.id)) {
                return;
            }

            // Permissions/Bot filters
            if (!SCAN_EVERYTHING) {
                if (message.author.bot) return;
                if (message.member && !message.member.moderatable) return;
            }

            await spamManager.handleMessage(message);
        });

        try {
            await bot.login(config.token);
            clients.push(bot);
        } catch (err) {
            console.error(`[Error] Failed to login bot with token starting with ${config.token.substring(0, 10)}... :`, err);
        }
    }

    return {
        stop: async () => {
            await messageAnalyzer.destroyWorker();
            for (const bot of clients) {
                bot.destroy();
            }
            process.exit(0);
        }
    }
}

const { stop } = await init().catch((err) => {
    console.error(`Failed to initialize: ${err}`);
    process.exit(1);
});

process.on('SIGINT', () => stop());
process.on('unhandledRejection', (r) => console.error('Unhandled Rejection:', r));
process.on('uncaughtException', (e) => console.error('Uncaught Exception:', e));
