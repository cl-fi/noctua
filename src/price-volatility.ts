/**
 * SUI price volatility analysis via CoinGecko public API (no API key, no geo-restrictions).
 * Used by LLM to auto-calibrate Health Factor thresholds.
 */

export interface VolatilityReport {
  currentPrice: number;
  change24h: number;        // 24h price change %
  change72h: number;        // 72h price change %
  maxDrawdown24h: number;   // 24h max drawdown %
  volatility24h: number;    // 24h volatility (std/mean)
  klineSummary: string;     // Human-readable summary for LLM consumption
}

/**
 * Fetch SUI market data from CoinGecko (free, no API key, no geo-restrictions).
 * Uses /coins/{id}/market_chart endpoint for hourly price history.
 */
export async function getSuiVolatility(): Promise<VolatilityReport | null> {
  try {
    // CoinGecko: 3 days of hourly data
    const url = 'https://api.coingecko.com/api/v3/coins/sui/market_chart?vs_currency=usd&days=3';
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`CoinGecko API ${res.status}`);

    const data: { prices: [number, number][] } = await res.json();
    const prices = data.prices; // [[timestamp_ms, price], ...]

    if (!prices || prices.length < 24) throw new Error('Insufficient price data');

    const currentPrice = prices[prices.length - 1][1];

    // Find price ~24h ago and ~72h ago
    const now = Date.now();
    const price24hAgo = findPriceAt(prices, now - 24 * 3600 * 1000);
    const price72hAgo = prices[0][1]; // earliest point (~72h ago)

    const change24h = ((currentPrice - price24hAgo) / price24hAgo) * 100;
    const change72h = ((currentPrice - price72hAgo) / price72hAgo) * 100;

    // Last 24h prices for drawdown and volatility
    const cutoff24h = now - 24 * 3600 * 1000;
    const last24hPrices = prices.filter(p => p[0] >= cutoff24h).map(p => p[1]);

    // Max drawdown: peak-to-trough
    let peak = last24hPrices[0];
    let maxDrawdown = 0;
    for (const price of last24hPrices) {
      if (price > peak) peak = price;
      const drawdown = ((peak - price) / peak) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // Volatility: std of hourly returns
    const returns: number[] = [];
    for (let i = 1; i < last24hPrices.length; i++) {
      returns.push((last24hPrices[i] - last24hPrices[i - 1]) / last24hPrices[i - 1]);
    }
    const meanReturn = returns.length > 0
      ? returns.reduce((a, b) => a + b, 0) / returns.length
      : 0;
    const variance = returns.length > 0
      ? returns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / returns.length
      : 0;
    const volatility24h = Math.sqrt(variance) * 100;

    const high24h = Math.max(...last24hPrices);
    const low24h = Math.min(...last24hPrices);

    const klineSummary = [
      `SUI/USD Price Analysis (last 72h):`,
      `Current price: $${currentPrice.toFixed(4)}`,
      `24h change: ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`,
      `72h change: ${change72h >= 0 ? '+' : ''}${change72h.toFixed(2)}%`,
      `24h max drawdown: -${maxDrawdown.toFixed(2)}%`,
      `24h hourly volatility (σ): ${volatility24h.toFixed(3)}%`,
      `24h high: $${high24h.toFixed(4)}`,
      `24h low: $${low24h.toFixed(4)}`,
    ].join('\n');

    return { currentPrice, change24h, change72h, maxDrawdown24h: maxDrawdown, volatility24h, klineSummary };
  } catch (err: any) {
    console.error(`[Volatility] Failed to fetch SUI price data: ${err.message}`);
    return null;
  }
}

/** Find the price closest to a target timestamp */
function findPriceAt(prices: [number, number][], targetMs: number): number {
  let closest = prices[0];
  let minDiff = Math.abs(prices[0][0] - targetMs);
  for (const p of prices) {
    const diff = Math.abs(p[0] - targetMs);
    if (diff < minDiff) {
      minDiff = diff;
      closest = p;
    }
  }
  return closest[1];
}
