export class WalrusLogger {
    config;
    constructor(config) {
        this.config = config;
    }
    async storeUnwindTrace(trace) {
        const data = new TextEncoder().encode(JSON.stringify(trace, null, 2));
        const response = await fetch(`${this.config.walrusPublisherUrl}/v1/blobs?epochs=${this.config.walrusEpochs}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: data,
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Walrus store failed (${response.status}): ${text}`);
        }
        const result = await response.json();
        if (result.newlyCreated) {
            return result.newlyCreated.blobObject.blobId;
        }
        else if (result.alreadyCertified) {
            return result.alreadyCertified.blobId;
        }
        throw new Error(`Unexpected Walrus response: ${JSON.stringify(result)}`);
    }
    async readUnwindTrace(blobId) {
        const response = await fetch(`${this.config.walrusAggregatorUrl}/v1/blobs/${blobId}`);
        if (!response.ok) {
            throw new Error(`Walrus read failed (${response.status})`);
        }
        const data = new Uint8Array(await response.arrayBuffer());
        return JSON.parse(new TextDecoder().decode(data));
    }
}
//# sourceMappingURL=walrus-logger.js.map