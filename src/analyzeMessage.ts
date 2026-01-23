import type { Message } from "discord.js";
import { createWorker } from "tesseract.js";

export class MessageAnalyzer {
    // "The requested module 'tesseract.js' does not provide an export named 'Worker'"
    private ocrWorker: Awaited<ReturnType<typeof createWorker>> | null;
    public bannedWords: string[];
    public debug: boolean;
    public static URL_REGEX = /(https?:\/\/[^\s]+)/g;
    private static IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    private cache: Map<string, { foundWords: boolean, bannedWords?: { url: string, word: string }[] }>;

    constructor(bannedWords?: string[], debug: boolean = false) {
        this.bannedWords = bannedWords || [];
        this.debug = debug;
        this.cache = new Map();
    }

    public async destroyWorker() {
        if (!this.ocrWorker) {
            return;
        }
        await this.ocrWorker.terminate();
        this.ocrWorker = null;
        this.cache.clear();
    }

    public async initializeWorker() {
        this.ocrWorker = await createWorker("eng");
    }

    public async analyzeMessage(message: Message): Promise<{ foundWords: false } | { foundWords: true, bannedWords: { url: string, word: string }[] }> {
        if (!this.ocrWorker) {
            throw new Error("OCR worker not initialized");
        }
        let attachmentUrls: string[] = [];

        let urlMatches = message.content.matchAll(MessageAnalyzer.URL_REGEX);
        let checkUrlPromises: Promise<void>[] = [];
        for (let url of urlMatches) {
            if (url[0]) {
                try {
                    let parsedUrl = new URL(url[0]);

                    // Optimization: check extension first before fetching
                    const hasImageExt = MessageAnalyzer.IMAGE_EXTENSIONS.some(ext => parsedUrl.pathname.toLowerCase().endsWith(ext));

                    if (hasImageExt) {
                        attachmentUrls.push(parsedUrl.href);
                        continue;
                    }

                    // Use HEAD request to check content-type without downloading body
                    checkUrlPromises.push(fetch(parsedUrl.href, { method: "HEAD" })
                        .then(fetchResult => {
                            if (fetchResult.ok && fetchResult.headers.get("content-type")?.startsWith("image/")) {
                                if (this.debug) console.log(`[DEBUG] Found Image URL in content (via HEAD): ${parsedUrl.href}`);
                                attachmentUrls.push(parsedUrl.href);
                            }
                        })
                        .catch(err => {
                            if (this.debug) console.error(`[DEBUG] HEAD request failed for ${parsedUrl.href}: ${err.message}`);
                        })
                    );
                } catch (error) {
                    if (this.debug) console.error(`[DEBUG] Failed to parse URL ${url[0]}`);
                    continue;
                }
            }
        }

        if (message.attachments.size > 0) {
            message.attachments.forEach(attachment => {
                if (attachment.contentType?.startsWith('image/')) {
                    console.log(`Found Attachment URL: ${attachment.url}`);
                    attachmentUrls.push(attachment.url);
                }
            });
        } else {
            console.log(`No attachments found in message ${message.id}`);
        }
        await Promise.all(checkUrlPromises);

        if (attachmentUrls.length === 0) {
            return { foundWords: false };
        }

        let bannedWords: { url: string, word: string }[] = [];

        for (const attachment of attachmentUrls) {
            // Optimization: Cache results by base URL (ignoring Discord's expiring query params)
            const cacheKey = attachment.split('?')[0];
            if (this.cache.has(cacheKey)) {
                const cached = this.cache.get(cacheKey)!;
                if (this.debug) console.log(`[DEBUG] Cache hit for ${cacheKey}: ${cached.foundWords}`);
                if (cached.foundWords) {
                    return { foundWords: true, bannedWords: cached.bannedWords! };
                }
                continue;
            }

            if (!this.ocrWorker) throw new Error("OCR worker not initialized");

            try {
                const ocr = await this.ocrWorker.recognize(attachment);
                const rawText = ocr.data.text.toLowerCase();

                if (this.debug) {
                    console.log(`[DEBUG] OCR Results for ${attachment}:`);
                    console.log(`[DEBUG] Confidence: ${ocr.data.confidence}%`);
                    console.log(`[DEBUG] Raw Text:\n${ocr.data.text}`);
                }

                let foundInThisImage = false;
                let currentBannedWords: { url: string, word: string }[] = [];

                for (let word of this.bannedWords) {
                    if (rawText.includes(word.toLowerCase())) {
                        if (this.debug) console.log(`[DEBUG] Match found: "${word}" in ${attachment}`);
                        currentBannedWords.push({ url: attachment, word });
                        foundInThisImage = true;
                    }
                }

                // Update global results and cache
                if (this.cache.size > 1000) this.cache.clear();
                this.cache.set(cacheKey, {
                    foundWords: foundInThisImage,
                    bannedWords: foundInThisImage ? currentBannedWords : undefined
                });

                if (foundInThisImage) {
                    if (this.debug) console.log(`[DEBUG] Early exit: Scam detected in ${attachment}`);
                    console.log(`Banned words found in message ${message.id}: ${currentBannedWords.map(bw => bw.word).join(", ")}`);
                    return { foundWords: true, bannedWords: currentBannedWords };
                }
            } catch (err) {
                console.error(`Failed to recognize image ${attachment}: ${err}`);
            }
        }

        console.log(`No banned words found in message ${message.id}`);
        return { foundWords: false };
    }
}
