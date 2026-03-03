import * as fs from 'fs';
import * as path from 'path';
const NOTIFICATION_FILE = path.join(process.cwd(), 'noctua-notifications.log');
function appendNotification(message) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(NOTIFICATION_FILE, line);
    console.log(message);
}
export function notifyUnwind(trace) {
    const msg = [
        `🦉 Crisis averted! HF restored from ${trace.triggerHF.toFixed(2)} → ${trace.restoredHF.toFixed(2)}`,
        `   Strategy: ${trace.strategy}`,
        `   Sold ${trace.collateralSold.amount} ${trace.collateralSold.symbol} → Repaid ${trace.debtRepaid.amount} ${trace.debtRepaid.symbol}`,
        `   TX: ${trace.txDigest}`,
        trace.walrusBlobId ? `   Audit: ${trace.walrusBlobId}` : '',
        `   You're safe. Go back to sleep. 🌙`,
    ].filter(Boolean).join('\n');
    appendNotification(msg);
}
export function notifyWarning(snapshot, triggerHF) {
    const distance = ((snapshot.healthFactor - triggerHF) / triggerHF * 100).toFixed(1);
    appendNotification(`⚠️ HF ${snapshot.healthFactor.toFixed(4)} — ${distance}% above trigger (${triggerHF}). Watching closely.`);
}
export function notifyError(error) {
    appendNotification(`❌ Error: ${error}`);
}
export function notifyStatus(hf, rule) {
    appendNotification(`🦉 Status: HF ${hf.toFixed(4)} | Trigger: ${rule.triggerHF} | Target: ${rule.targetHF} | ${rule.paused ? 'PAUSED' : 'ACTIVE'}`);
}
//# sourceMappingURL=notification.js.map