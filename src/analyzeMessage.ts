import type { Message } from "discord.js";
import { TesseractEngine } from "./engines/TesseractEngine.ts";
import { GeminiEngine } from "./engines/GeminiEngine.ts";
import { MediaExtractor } from "./utils/MediaExtractor.ts";

export interface ScanResult {
    foundWords: boolean;
    bannedWords?: { url: string, word: string }[];
}

export class MessageAnalyzer {
    private tesseract: TesseractEngine;
    private gemini: GeminiEngine | null = null;
    private bannedWords: string[];
    private debug: boolean;
    private cache: Map<string, ScanResult>;

    constructor(bannedWords?: string[], debug: boolean = false) {
        this.bannedWords = bannedWords || [];
        this.debug = debug;
        this.cache = new Map();
        this.tesseract = new TesseractEngine();

        const geminiKey = process.env.GEMINI_API_KEY;
        if (geminiKey) {
            this.gemini = new GeminiEngine(geminiKey, "gemini-2.5-flash-lite");
            console.log("[INIT] Gemini OCR engine initialized (Model: gemini-2.5-flash-lite)");
        } else if (this.debug) {
            console.log("[DEBUG] Gemini API key not found, fallback disabled.");
        }
    }

    public async initializeWorker() {
        await this.tesseract.initialize();
    }

    public async destroyWorker() {
        await this.tesseract.destroy();
        this.cache.clear();
    }

    public async analyzeMessage(message: Message): Promise<ScanResult> {
        const attachmentUrls = await MediaExtractor.extractImageUrls(message, this.debug);

        if (attachmentUrls.length === 0) {
            return { foundWords: false };
        }

        // 1. Basic OCR (Tesseract) - Loop all images
        for (const url of attachmentUrls) {
            const result = await this.scanWithEngine(this.tesseract, url);
            if (result.foundWords) {
                console.log(`[Tesseract] Banned words found in message ${message.id}`);
                return result;
            }
        }

        // 2. Gemini Fallback - Only if 4 images detected and basic OCR failed
        if (attachmentUrls.length === 4 && this.gemini) {
            const firstImage = attachmentUrls[0];
            if (this.debug) console.log(`[DEBUG] [FALLBACK] Using Gemini for first image: ${firstImage}`);

            const result = await this.scanWithEngine(this.gemini, firstImage);
            if (result.foundWords) {
                console.log(`[GEMINI FALLBACK] Banned words found in message ${message.id}`);
                return result;
            }
        }

        if (this.debug) console.log(`[DEBUG] No banned words found in message ${message.id}`);
        return { foundWords: false };
    }

    private async scanWithEngine(engine: TesseractEngine | GeminiEngine, url: string): Promise<ScanResult> {
        const urlPart = url.split('?')[0];
        // Cache key includes engine name so Tesseract "clean" result doesn't block Gemini scan
        const cacheKey = `${engine.name}:${urlPart}`;

        // Cache Check
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey)!;
            if (this.debug) console.log(`[DEBUG] Cache hit for ${cacheKey}: ${cached.foundWords}`);
            return cached;
        }

        try {
            const ocr = await engine.recognize(url);
            const rawText = ocr.text.toLowerCase();

            let foundWords: { url: string, word: string }[] = [];
            for (let word of this.bannedWords) {
                if (rawText.includes(word.toLowerCase())) {
                    foundWords.push({ url, word });
                }
            }

            const scanResult = {
                foundWords: foundWords.length > 0,
                bannedWords: foundWords.length > 0 ? foundWords : undefined
            };

            // Only cache if clean or if we found something (we want to avoid re-running expensive Gemini if possible)
            if (this.cache.size > 1000) this.cache.clear();
            this.cache.set(cacheKey, scanResult);

            return scanResult;
        } catch (err) {
            console.error(`[${engine.name}] Scan failed for ${url}:`, err);
            return { foundWords: false };
        }
    }
}
