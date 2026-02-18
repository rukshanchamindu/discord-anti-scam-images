import { Client, IntentsBitField } from 'discord.js';
import ms from 'ms';
import type { StringValue } from 'ms';
import { MessageAnalyzer } from "./analyzeMessage.ts";
import { SpamManager } from "./services/SpamManager.ts";
import 'dotenv/config';

async function init() {
    const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "";
    const ALLOWED_CHANNELS = process.env.ALLOWED_CHANNELS?.split(",") || [];
    const DISALLOWED_CHANNELS = process.env.DISALLOWED_CHANNELS?.split(",") || [];
    const IS_WHITELIST = process.env.IS_WHITELIST === "true";
    const BANNED_WORDS = process.env.BANNED_WORDS?.split(",") || ["crypto casino", "special promo code"];
    const LOG_CHANNEL = process.env.LOG_CHANNEL || "";
    const SHOULD_DELETE = process.env.SHOULD_DELETE !== "false";
    const SHOULD_PUNISH = process.env.SHOULD_PUNISH !== "false";
    const TIMEOUT_DURATION = ms((process.env.TIMEOUT_DURATION || "7d") as StringValue);
    const SCAN_EVERYTHING = process.env.SCAN_EVERYTHING !== "false";
    const TRIGGERS_BEFORE_ACTION = parseInt(process.env.TRIGGERS_BEFORE_ACTION || "1");
    const MASS_ANALYZER_DELAY = parseInt(process.env.MASS_ANALYZER_DELAY || "2000");
    const DEBUG = process.env.DEBUG === "true";

    const bot = new Client({
        intents: [IntentsBitField.Flags.MessageContent, IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMessages]
    });

    const messageAnalyzer = new MessageAnalyzer(BANNED_WORDS, DEBUG);
    const spamManager = new SpamManager(bot, messageAnalyzer, {
        debug: DEBUG,
        shouldDelete: SHOULD_DELETE,
        shouldPunish: SHOULD_PUNISH,
        timeoutDuration: TIMEOUT_DURATION,
        triggersBeforeAction: TRIGGERS_BEFORE_ACTION,
        massAnalyzerDelay: MASS_ANALYZER_DELAY,
        logChannelId: LOG_CHANNEL
    });

    await messageAnalyzer.initializeWorker();

    bot.on("clientReady", () => {
        console.log(`Logged in as ${bot.user?.tag}!`);
    });

    bot.on("messageCreate", async (message) => {
        if (message.author.id === bot.user?.id) return;

        // Channel filters
        if (IS_WHITELIST) {
            if (!ALLOWED_CHANNELS.includes(message.channel.id)) return;
        } else if (DISALLOWED_CHANNELS.includes(message.channel.id)) {
            return;
        }

        // Permissions/Bot filters
        if (!SCAN_EVERYTHING) {
            if (message.author.bot) return;
            if (message.member && !message.member.moderatable) return;
        }

        await spamManager.handleMessage(message);
    });

    bot.login(DISCORD_TOKEN);

    return {
        stop: async () => {
            await messageAnalyzer.destroyWorker();
            bot.destroy();
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
