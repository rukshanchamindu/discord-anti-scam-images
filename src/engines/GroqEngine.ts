import type { IOcrEngine, OcrResult } from "./types.ts";

export class GroqEngine implements IOcrEngine {
    public name = "Groq";
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model: string = "llama-3.2-11b-vision-preview") {
        this.apiKey = apiKey;
        this.model = model;
    }

    async recognize(imageUrl: string | string[]): Promise<OcrResult> {
        try {
            const urls = Array.isArray(imageUrl) ? imageUrl : [imageUrl];
            
            // Build the content array with all images
            const imageContent = urls.map(url => ({
                type: "image_url",
                image_url: { url }
            }));

            // Call Groq API (OpenAI-compatible) using direct image URLs
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "text",
                                    text: "Transcribe all text from these images exactly as it appears. If there is no text, return an empty string. Only return the transcribed text, nothing else."
                                },
                                ...imageContent
                            ]
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 1024
                })
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(`Groq API Error (${response.status}): ${err}`);
            }

            interface GroqResponse {
                choices?: Array<{
                    message?: {
                        content?: string;
                    };
                }>;
            }

            const data = await response.json() as GroqResponse;
            const text = data.choices?.[0]?.message?.content || "";

            return {
                text: text.trim()
            };

        } catch (error) {
            console.error(`[Groq] Recognition failed:`, error);
            return { text: "" };
        }
    }
}
