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
    const DEBUG = process.env.DEBUG === "true";

    if (DEBUG) {
        console.log("[DEBUG] Debug mode is enabled");
        console.log(`[DEBUG] Banned words: ${BANNED_WORDS.join(", ")}`);
        console.log(`[DEBUG] Whitelist mode: ${IS_WHITELIST}`);
    }

    let triggeredCounts = new Map<Snowflake, number>();
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

            // Only trigger OCR if there's actually something to scan
            if (message.attachments.size === 0 && !MessageAnalyzer.URL_REGEX.test(message.content)) {
                return;
            }
            MessageAnalyzer.URL_REGEX.lastIndex = 0; // Reset regex state

            // Now that we know OCR might be needed, ensure we have member data for moderation/punishment
            if (!message.member && message.guild) {
                try {
                    await message.guild.members.fetch(message.author.id);
                } catch (err) {
                    if (DEBUG) console.error(`[DEBUG] Failed to fetch member ${message.author.id}`);
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

            if (DEBUG) console.log(`[DEBUG] Analyzing message ${message.id} from ${message.author.tag}`);
            console.time(`Analyzing message ${message.id}`);
            let result = await messageAnalyzer.analyzeMessage(message);
            let deleted = "No (Config)";
            let punished = "No (Config)";

            if (result.foundWords) {
                console.log(`Detected banned words in message ${message.id}: ${result.bannedWords.map(bw => bw.word).join(", ")}`);

                const currentCount = (triggeredCounts.get(message.author.id) || 0) + 1;
                triggeredCounts.set(message.author.id, currentCount);

                if (triggeredCounts.size > 5000) {
                    const keys = Array.from(triggeredCounts.keys());
                    for (let i = 0; i < 1000; i++) triggeredCounts.delete(keys[i]);
                }

                let triggerCount = currentCount;

                if (SHOULD_DELETE) {
                    if (message.deletable) {
                        await message.delete().catch((err: any) => {
                            console.error(err);
                            deleted = "No (Error)";
                        }).then(() => {
                            deleted = "Yes";
                        });
                    } else {
                        console.warn(`Cannot delete message ${message.id}`);
                        deleted = "No (Cannot Delete)";
                    }
                }

                if (SHOULD_PUNISH) {
                    if (message.member && message.member.moderatable) {
                        if (triggerCount >= TRIGGERS_BEFORE_ACTION) {
                            await message.member.timeout(TIMEOUT_DURATION).catch((err: any) => {
                                console.error(err);
                                punished = "No (Error)";
                            }).then(() => {
                                punished = `Yes (for ${ms(TIMEOUT_DURATION, { long: true })})`;
                            });
                        } else {
                            punished = `No (Only ${triggerCount}/${TRIGGERS_BEFORE_ACTION} Triggers)`;
                        }
                    } else {
                        console.warn(`Cannot punish member ${message.member?.id} in message ${message.id}`);
                        punished = "No (Cannot Moderate)";
                    }
                }


                if (logChannel && logChannel.isSendable()) {
                    let words = [...new Set(result.bannedWords.map(bw => bw.word))];
                    let urls = [...new Set(result.bannedWords.map(bw => bw.url))];
                    let embed = new EmbedBuilder()
                        .setAuthor({ name: `${message.author.tag} (${message.author.id})`, iconURL: message.author.displayAvatarURL() })
                        .setTitle("Detected OCR Scam Message")
                        .setDescription(`Triggered OCR with words:\n${words.join(", ")}\n\n**URLs:**\n${urls.join("\n")}`)
                        .addFields({ name: "User", value: `${message.author.toString()}`, inline: true })
                        .addFields({ name: "Channel", value: `${message.channel.toString()}`, inline: true })
                        .addFields({ name: "Message ID", value: `${message.id}`, inline: true })
                        .addFields({ name: "Deleted", value: `${deleted} `, inline: true })
                        .addFields({ name: "Punished", value: `${punished} `, inline: true })
                        .addFields({ name: "Times Triggered", value: `${triggerCount} `, inline: true })
                        .setColor(Colors.Red)
                        .setTimestamp()
                    logChannel.send({ embeds: [embed] }).catch(console.error);
                }
            }
            console.timeEnd(`Analyzing message ${message.id}`);
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
