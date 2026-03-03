/**
 * SUI price volatility analysis via CoinGecko public API (no API key, no geo-restrictions).
 * Used by LLM to auto-calibrate Health Factor thresholds.
 */
export interface VolatilityReport {
    currentPrice: number;
    change24h: number;
    change72h: number;
    maxDrawdown24h: number;
    volatility24h: number;
    klineSummary: string;
}
/**
 * Fetch SUI market data from CoinGecko (free, no API key, no geo-restrictions).
 * Uses /coins/{id}/market_chart endpoint for hourly price history.
 */
export declare function getSuiVolatility(): Promise<VolatilityReport | null>;
