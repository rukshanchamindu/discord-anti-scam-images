import type { Message } from "discord.js";
import { TesseractEngine } from "./engines/TesseractEngine.ts";
import { GeminiEngine } from "./engines/GeminiEngine.ts";
import { OcrSpaceEngine } from "./engines/OcrSpaceEngine.ts";
import { GroqEngine } from "./engines/GroqEngine.ts";
import { MediaExtractor } from "./utils/MediaExtractor.ts";
import type { IOcrEngine } from "./engines/types.ts";

export interface ScanResult {
    foundWords: boolean;
    bannedWords?: { url: string, word: string }[];
}

export class MessageAnalyzer {
    private engines: IOcrEngine[] = [];
    private bannedWords: string[];
    private debug: boolean;
    private cache: Map<string, ScanResult>;
    private geminiTriggerCount: number;
    private maxAttachments: number;


    constructor(bannedWords?: string[], debug: boolean = false) {
        this.bannedWords = bannedWords || [];
        this.debug = debug;
        this.cache = new Map();

        this.geminiTriggerCount = parseInt(process.env.GEMINI_TRIGGER_COUNT || "4");
        this.maxAttachments = parseInt(process.env.MAX_ATTACHMENTS || "8");


        const engineOrder = (process.env.OCR_ENGINE_ORDER || "tesseract,ocrspace,gemini")
            .split(",")
            .map(s => s.trim().toLowerCase());

        for (const name of engineOrder) {
            if (name === "tesseract") {
                this.engines.push(new TesseractEngine());
                if (this.debug) console.log("[INIT] Tesseract OCR engine enabled");
            } else if (name === "ocrspace") {
                const ocrSpaceKey = process.env.OCR_SPACE_API_KEY;
                if (ocrSpaceKey) {
                    this.engines.push(new OcrSpaceEngine(ocrSpaceKey));
                    if (this.debug) console.log("[INIT] OcrSpace OCR engine enabled");
                } else if (this.debug) {
                    console.log("[DEBUG] OCR_SPACE_API_KEY not found, OcrSpace disabled.");
                }
            } else if (name === "gemini") {
                const geminiKey = process.env.GEMINI_API_KEY;
                const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
                if (geminiKey) {
                    this.engines.push(new GeminiEngine(geminiKey, geminiModel));
                    if (this.debug) console.log(`[INIT] Gemini OCR engine initialized (Model: ${geminiModel})`);
                } else if (this.debug) {
                    console.log("[DEBUG] GEMINI_API_KEY not found, Gemini disabled.");
                }
            } else if (name === "groq") {
                const groqKey = process.env.GROQ_API_KEY;
                const groqModel = process.env.GROQ_MODEL || "llama-3.2-11b-vision-preview";
                if (groqKey) {
                    this.engines.push(new GroqEngine(groqKey, groqModel));
                    if (this.debug) console.log(`[INIT] Groq OCR engine initialized (Model: ${groqModel})`);
                } else if (this.debug) {
                    console.log("[DEBUG] GROQ_API_KEY not found, Groq disabled.");
                }

            } else {
                console.warn(`[WARN] Unknown OCR engine specified in OCR_ENGINE_ORDER: ${name}`);
            }
        }
    }

    public async initializeWorker() {
        for (const engine of this.engines) {
            if (engine.initialize) {
                await engine.initialize();
            }
        }
    }

    public async destroyWorker() {
        for (const engine of this.engines) {
            if (engine.destroy) {
                await engine.destroy();
            }
        }
        this.cache.clear();
    }

    public async analyzeMessage(message: Message): Promise<ScanResult> {
        const attachmentUrls = await MediaExtractor.extractImageUrls(message, this.debug);

        if (attachmentUrls.length === 0) {
            return { foundWords: false };
        }

        // Safety check: Skip messages with too many attachments to avoid API abuse/lag
        if (attachmentUrls.length > this.maxAttachments) {
            if (this.debug) console.log(`[DEBUG] Skipping message ${message.id} (too many attachments: ${attachmentUrls.length}, limit: ${this.maxAttachments})`);
            return { foundWords: false };
        }


        for (const engine of this.engines) {
            // High-performance AI engines: Pass all images at once
            if (engine.name === "Groq") {
                const result = await this.scanWithEngine(engine, attachmentUrls);
                if (result.foundWords) {
                    console.log(`[Groq Multi-Scan] Banned words found in message ${message.id}`);
                    return result;
                }
                continue;
            }

            if (engine.name === "Gemini") {
                // Special logic for Gemini: Only if specific number of images detected (default 4)
                if (attachmentUrls.length === this.geminiTriggerCount) {
                    if (this.debug) console.log(`[DEBUG] [FALLBACK] Using Gemini for all images: ${attachmentUrls.length}`);
                    const result = await this.scanWithEngine(engine, attachmentUrls);
                    if (result.foundWords) {
                        console.log(`[Gemini Fallback] Banned words found in message ${message.id}`);
                        return result;
                    }
                }
                continue;
            }

            // Normal OCR engines (Tesseract, OcrSpace): Loop all images individually
            for (const url of attachmentUrls) {
                const result = await this.scanWithEngine(engine, url);
                if (result.foundWords) {
                    console.log(`[${engine.name}] Banned words found in message ${message.id}`);
                    return result;
                }
            }
        }

        return { foundWords: false };
    }

    private async scanWithEngine(engine: IOcrEngine, url: string | string[]): Promise<ScanResult> {
        // Use joined URLs for cache key if it's an array
        const urlPart = Array.isArray(url) 
            ? url.map(u => u.split('?')[0]).join('|') 
            : url.split('?')[0];
            
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
            
            // If it's a multi-scan, the 'url' passed to bannedWords is the first one or a placeholder
            const displayUrl = Array.isArray(url) ? url[0] : url;

            for (let word of this.bannedWords) {
                if (rawText.includes(word.toLowerCase())) {
                    foundWords.push({ url: displayUrl, word });
                }
            }

            const scanResult = {
                foundWords: foundWords.length > 0,
                bannedWords: foundWords.length > 0 ? foundWords : undefined
            };

            // Only cache if clean or if we found something
            if (this.cache.size > 1000) this.cache.clear();
            this.cache.set(cacheKey, scanResult);

            return scanResult;
        } catch (err) {
            const errUrl = Array.isArray(url) ? `[${url.length} images]` : url;
            console.error(`[${engine.name}] Scan failed for ${errUrl}:`, err);
            return { foundWords: false };
        }
    }
}

