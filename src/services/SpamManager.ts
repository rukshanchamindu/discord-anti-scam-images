import { Client, Message, EmbedBuilder, Colors } from "discord.js";
import type { Snowflake } from "discord.js";
import ms from "ms";
import type { StringValue } from "ms";
import { MessageAnalyzer } from "../analyzeMessage.ts";
import { MediaExtractor } from "../utils/MediaExtractor.ts";

export class SpamManager {
    private triggeredCounts = new Map<Snowflake, number>();
    private userQueues = new Map<Snowflake, Message[]>();
    private userTimers = new Map<Snowflake, NodeJS.Timeout>();

    private bot: Client;
    private analyzer: MessageAnalyzer;
    private config: {
        debug: boolean;
        shouldDelete: boolean;
        shouldPunish: boolean;
        timeoutDuration: number;
        triggersBeforeAction: number;
        massAnalyzerDelay: number;
        logChannelId: string;
    };

    constructor(
        bot: Client,
        analyzer: MessageAnalyzer,
        config: {
            debug: boolean;
            shouldDelete: boolean;
            shouldPunish: boolean;
            timeoutDuration: number;
            triggersBeforeAction: number;
            massAnalyzerDelay: number;
            logChannelId: string;
        }
    ) {
        this.bot = bot;
        this.analyzer = analyzer;
        this.config = config;
    }

    public async handleMessage(message: Message) {
        const userId = message.author.id;
        const queue = this.userQueues.get(userId) || [];
        queue.push(message);
        this.userQueues.set(userId, queue);

        if (this.config.debug) {
            console.log(`[DEBUG] Queued message ${message.id} from ${message.author.tag} (${queue.length} in queue)`);
        }

        if (this.userTimers.has(userId)) {
            clearTimeout(this.userTimers.get(userId)!);
        }

        this.userTimers.set(userId, setTimeout(() => this.processQueue(userId), this.config.massAnalyzerDelay));
    }

    private async processQueue(userId: Snowflake) {
        const messagesToProcess = this.userQueues.get(userId) || [];
        this.userQueues.delete(userId);
        this.userTimers.delete(userId);

        if (messagesToProcess.length === 0) return;

        if (this.config.debug) {
            console.log(`[DEBUG] Starting processing for user ${userId} (${messagesToProcess.length} messages)`);
        }

        let spamResult: any = null;
        let spamMessage: Message | null = null;

        for (const msg of messagesToProcess) {
            // Check if it's worth analyzing
            const hasMedia = msg.attachments.size > 0 || MediaExtractor.URL_REGEX.test(msg.content);
            MediaExtractor.URL_REGEX.lastIndex = 0;

            if (hasMedia) {
                if (!msg.member && msg.guild) {
                    await msg.guild.members.fetch(msg.author.id).catch(() => { });
                }

                const result = await this.analyzer.analyzeMessage(msg);
                if (result.foundWords) {
                    spamResult = result;
                    spamMessage = msg;
                    break;
                }
            }
        }

        if (spamResult && spamMessage) {
            await this.takeAction(userId, spamMessage, messagesToProcess, spamResult);
        }
    }

    private async takeAction(userId: Snowflake, spamMessage: Message, allMessages: Message[], result: any) {
        const currentCount = (this.triggeredCounts.get(userId) || 0) + 1;
        this.triggeredCounts.set(userId, currentCount);

        // Cleanup map occasionally
        if (this.triggeredCounts.size > 5000) {
            const keys = Array.from(this.triggeredCounts.keys()).slice(0, 1000);
            keys.forEach(k => this.triggeredCounts.delete(k));
        }

        let deletedCount = 0;
        if (this.config.shouldDelete) {
            for (const msg of allMessages) {
                if (msg.deletable) {
                    await msg.delete().catch(e => console.error(`[ERROR] Delete failed: ${e.message}`));
                    deletedCount++;
                }
            }
        }

        let punishStatus = "No";
        if (this.config.shouldPunish && spamMessage.member?.moderatable) {
            if (currentCount >= this.config.triggersBeforeAction) {
                await spamMessage.member.timeout(this.config.timeoutDuration).catch(e => {
                    punishStatus = `Error: ${e.message}`;
                });
                punishStatus = "Yes";
            } else {
                punishStatus = `Pending (${currentCount}/${this.config.triggersBeforeAction})`;
            }
        }

        await this.logAction(spamMessage, allMessages.length, deletedCount, punishStatus, currentCount, result);
    }

    private async logAction(msg: Message, batchSize: number, deleted: number, punish: string, total: number, result: any) {
        if (!this.config.logChannelId) return;
        const channel = await this.bot.channels.fetch(this.config.logChannelId).catch(() => null);
        if (!channel || !channel.isSendable()) return;

        const words = [...new Set(result.bannedWords.map((bw: any) => bw.word))];
        const urls = [...new Set(result.bannedWords.map((bw: any) => bw.url))];

        const embed = new EmbedBuilder()
            .setAuthor({ name: `${msg.author.tag} (${msg.author.id})`, iconURL: msg.author.displayAvatarURL() })
            .setTitle("Detected Mass OCR Scam Activity")
            .setDescription(`Triggered OCR with words:\n${words.join(", ")}\n\n**URLs:**\n${urls.join("\n")}`)
            .addFields(
                { name: "User", value: msg.author.toString(), inline: true },
                { name: "Channel", value: msg.channel.toString(), inline: true },
                { name: "Messages in Batch", value: batchSize.toString(), inline: true },
                { name: "Deleted Messages", value: deleted.toString(), inline: true },
                { name: "Punished", value: punish, inline: true },
                { name: "Times Triggered", value: total.toString(), inline: true }
            )
            .setColor(Colors.Red)
            .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => { });
    }
}
