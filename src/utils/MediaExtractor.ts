import type { Message } from "discord.js";

export class MediaExtractor {
    public static URL_REGEX = /(https?:\/\/[^\s]+)/g;
    private static IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

    public static async extractImageUrls(message: Message, debug: boolean = false): Promise<string[]> {
        let attachmentUrls: string[] = [];

        // Check content for raw URLs
        let urlMatches = message.content.matchAll(this.URL_REGEX);
        let checkUrlPromises: Promise<void>[] = [];

        for (let url of urlMatches) {
            if (url[0]) {
                try {
                    let parsedUrl = new URL(url[0]);
                    const hasImageExt = this.IMAGE_EXTENSIONS.some(ext => parsedUrl.pathname.toLowerCase().endsWith(ext));

                    if (hasImageExt) {
                        attachmentUrls.push(parsedUrl.href);
                        continue;
                    }

                    // Check content-type via HEAD
                    checkUrlPromises.push(fetch(parsedUrl.href, { method: "HEAD" })
                        .then(fetchResult => {
                            if (fetchResult.ok && fetchResult.headers.get("content-type")?.startsWith("image/")) {
                                attachmentUrls.push(parsedUrl.href);
                            }
                        })
                        .catch(err => {
                            if (debug) console.error(`[DEBUG] HEAD failed for ${parsedUrl.href}: ${err.message}`);
                        })
                    );
                } catch (error) {
                    continue;
                }
            }
        }

        // Check attachments
        if (message.attachments.size > 0) {
            message.attachments.forEach(attachment => {
                if (attachment.contentType?.startsWith('image/')) {
                    attachmentUrls.push(attachment.url);
                }
            });
        }

        await Promise.all(checkUrlPromises);
        return attachmentUrls;
    }
}
