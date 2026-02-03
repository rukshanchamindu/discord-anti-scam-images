import {
    Client,
    Colors,
    EmbedBuilder,
    IntentsBitField
} from 'discord.js';
import type { Snowflake, Message } from 'discord.js';

import ms from 'ms';
import type { StringValue } from 'ms';

import { MessageAnalyzer } from "./analyzeMessage.ts";
import 'dotenv/config';

async function init() {
    const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "";
    const ALLOWED_CHANNELS = process.env.ALLOWED_CHANNELS?.split(",") || [];
    const DISALLOWED_CHANNELS = process.env.DISALLOWED_CHANNELS?.split(",") || [];
    const IS_WHITELIST = process.env.IS_WHITELIST === "true";
    const BANNED_WORDS = process.env.BANNED_WORDS?.split(",") || ["crypto casino", "special promo code", "withdrawl successful", "free gift"];
    const LOG_CHANNEL = process.env.LOG_CHANNEL || "";
    const SHOULD_DELETE = process.env.SHOULD_DELETE ? process.env.SHOULD_DELETE === `true` : "true";
    const SHOULD_PUNISH = process.env.SHOULD_PUNISH ? process.env.SHOULD_PUNISH === `true` : "true";
    const TIMEOUT_DURATION = process.env.TIMEOUT_DURATION ? ms(process.env.TIMEOUT_DURATION as StringValue) : ms("7d");
    const SCAN_EVERYTHING = process.env.SCAN_EVERYTHING ? process.env.SCAN_EVERYTHING === "true" : true;
    const TRIGGERS_BEFORE_ACTION = process.env.TRIGGERS_BEFORE_ACTION ? parseInt(process.env.TRIGGERS_BEFORE_ACTION) : 1;
    const MASS_ANALYZER_DELAY = process.env.MASS_ANALYZER_DELAY ? parseInt(process.env.MASS_ANALYZER_DELAY) : 2000;
    const DEBUG = process.env.DEBUG === "true";

    if (DEBUG) {
        console.log("[DEBUG] Debug mode is enabled");
        console.log(`[DEBUG] Banned words: ${BANNED_WORDS.join(", ")}`);
        console.log(`[DEBUG] Whitelist mode: ${IS_WHITELIST}`);
    }

    let triggeredCounts = new Map<Snowflake, number>();
    const userQueues = new Map<Snowflake, Message[]>();
    const userTimers = new Map<Snowflake, NodeJS.Timeout>();
    const bot = new Client({
        intents: [IntentsBitField.Flags.MessageContent, IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMessages]
    });
    const messageAnalyzer = new MessageAnalyzer(BANNED_WORDS, DEBUG);

    await messageAnalyzer.initializeWorker();

    let logChannel: any = null;

    bot.on("clientReady", async () => {
        console.log(`Logged in as ${bot.user?.tag}!`);

        // Cache log channel once
        if (LOG_CHANNEL && LOG_CHANNEL !== "") {
            try {
                logChannel = await bot.channels.fetch(LOG_CHANNEL);
                if (logChannel) {
                    console.log(`[INIT] Log channel cached: #${logChannel.name}`);
                }
            } catch (err) {
                console.error(`[INIT] Failed to fetch log channel: ${err}`);
            }
        }
    });

    bot.on("messageCreate", async (message: Message) => {
        try {
            if (message.author.id === bot.user?.id) {
                return;
            }

            if (IS_WHITELIST) {
                if (!ALLOWED_CHANNELS.includes(message.channel.id)) {
                    if (DEBUG) console.log(`[DEBUG] Skipping message ${message.id} - channel not in whitelist`);
                    return;
                }
            } else if (DISALLOWED_CHANNELS.length > 0) {
                if (DISALLOWED_CHANNELS.includes(message.channel.id)) {
                    if (DEBUG) console.log(`[DEBUG] Skipping message ${message.id} - channel in blacklist`);
                    return;
                }
            }

            if (!SCAN_EVERYTHING) {
                if (message.author.bot) {
                    if (DEBUG) console.log(`[DEBUG] Skipping message ${message.id} - author is a bot`);
                    return;
                }

                if (message.member && !message.member.moderatable) {
                    if (DEBUG) console.log(`[DEBUG] Skipping message ${message.id} - author not moderatable`);
                    return;
                }
            }

            // Queue the message for mass analysis
            const userId = message.author.id;
            const queue = userQueues.get(userId) || [];
            queue.push(message);
            userQueues.set(userId, queue);

            if (DEBUG) console.log(`[DEBUG] Queued message ${message.id} from ${message.author.tag} (${queue.length} in queue)`);

            // Reset or start the timer
            if (userTimers.has(userId)) {
                clearTimeout(userTimers.get(userId)!);
            }

            userTimers.set(userId, setTimeout(async () => {
                const messagesToProcess = userQueues.get(userId) || [];
                userQueues.delete(userId);
                userTimers.delete(userId);

                if (messagesToProcess.length === 0) return;

                if (DEBUG) console.log(`[DEBUG] Starting mass analysis for user ${userId} with ${messagesToProcess.length} messages`);

                let spamResult: any = null;
                let spamMessage: Message | null = null;

                for (const msg of messagesToProcess) {
                    // Check if it has attachments or URLs that might be images
                    if (msg.attachments.size > 0 || MessageAnalyzer.URL_REGEX.test(msg.content)) {
                        MessageAnalyzer.URL_REGEX.lastIndex = 0; // Reset regex

                        // Ensure we have member data for moderation/punishment
                        if (!msg.member && msg.guild) {
                            try {
                                await msg.guild.members.fetch(msg.author.id);
                            } catch (err) {
                                if (DEBUG) console.error(`[DEBUG] Failed to fetch member ${msg.author.id}`);
                            }
                        }

                        if (DEBUG) console.log(`[DEBUG] Analyzing message ${msg.id} in mass batch`);
                        const result = await messageAnalyzer.analyzeMessage(msg);
                        if (result.foundWords) {
                            spamResult = result;
                            spamMessage = msg;
                            break; // Stop at first spam detected
                        }
                    }
                }

                if (spamResult && spamMessage) {
                    console.log(`Detected banned words in mass batch for user ${userId}: ${spamResult.bannedWords.map((bw: any) => bw.word).join(", ")}`);

                    const currentCount = (triggeredCounts.get(userId) || 0) + 1;
                    triggeredCounts.set(userId, currentCount);

                    if (triggeredCounts.size > 5000) {
                        const keys = Array.from(triggeredCounts.keys());
                        for (let i = 0; i < 1000; i++) triggeredCounts.delete(keys[i]);
                    }

                    let triggerCount = currentCount;
                    let deletedCount = 0;
                    let punishStatus = "No (Config)";

                    if (SHOULD_DELETE) {
                        for (const msg of messagesToProcess) {
                            if (msg.deletable) {
                                await msg.delete().catch((err: any) => {
                                    console.error(`[ERROR] Failed to delete message ${msg.id}: ${err}`);
                                }).then(() => {
                                    deletedCount++;
                                });
                            }
                        }
                    }

                    if (SHOULD_PUNISH) {
                        const member = spamMessage.member;
                        if (member && member.moderatable) {
                            if (triggerCount >= TRIGGERS_BEFORE_ACTION) {
                                await member.timeout(TIMEOUT_DURATION).catch((err: any) => {
                                    console.error(err);
                                    punishStatus = "No (Error)";
                                }).then(() => {
                                    punishStatus = `Yes (for ${ms(TIMEOUT_DURATION, { long: true })})`;
                                });
                            } else {
                                punishStatus = `No (Only ${triggerCount}/${TRIGGERS_BEFORE_ACTION} Triggers)`;
                            }
                        } else {
                            punishStatus = "No (Cannot Moderate)";
                        }
                    }

                    if (logChannel && logChannel.isSendable()) {
                        let words = [...new Set(spamResult.bannedWords.map((bw: any) => bw.word))];
                        let urls = [...new Set(spamResult.bannedWords.map((bw: any) => bw.url))];
                        let embed = new EmbedBuilder()
                            .setAuthor({ name: `${spamMessage.author.tag} (${spamMessage.author.id})`, iconURL: spamMessage.author.displayAvatarURL() })
                            .setTitle("Detected Mass OCR Scam Activity")
                            .setDescription(`Triggered OCR with words:\n${words.join(", ")}\n\n**URLs:**\n${urls.join("\n")}`)
                            .addFields({ name: "User", value: `${spamMessage.author.toString()}`, inline: true })
                            .addFields({ name: "Channel", value: `${spamMessage.channel.toString()}`, inline: true })
                            .addFields({ name: "Messages in Batch", value: `${messagesToProcess.length}`, inline: true })
                            .addFields({ name: "Deleted Messages", value: `${deletedCount}`, inline: true })
                            .addFields({ name: "Punished", value: `${punishStatus}`, inline: true })
                            .addFields({ name: "Times Triggered", value: `${triggerCount}`, inline: true })
                            .setColor(Colors.Red)
                            .setTimestamp()
                        logChannel.send({ embeds: [embed] }).catch(console.error);
                    }
                }
            }, MASS_ANALYZER_DELAY));

        } catch (err) {
            console.error(`Error in messageCreate handler: ${err}`);
        }
    });

    bot.login(DISCORD_TOKEN);

    return {
        bot,
        stop: async () => {
            messageAnalyzer.destroyWorker();
            bot.destroy();
            process.exit(0);
        }
    }
}

if (process.argv[1] === import.meta.filename) {
    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    process.on('uncaughtException', (err) => {
        console.error('Uncaught Exception thrown:', err);
        // Optionally exit or perform cleanup but usually safe to let it run for a bot
    });

    const { stop } = await init().catch((err) => {
        console.error(`Failed to initialize discord anti scam images: ${err}`);
        process.exit(1);
    });

    process.on('SIGINT', async () => {
        await stop();
    });

}
