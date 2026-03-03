# Heartbeat Instructions

Every heartbeat cycle, perform these checks:

1. Run `node /path/to/noctua/dist/cli.js status` to check the current monitoring state and Health Factor.

2. If there are any new unwind operations in the recent traces, notify the user immediately with:
   - What happened (HF drop and recovery)
   - What actions were taken (collateral sold, debt repaid)
   - The Walrus audit trail blob ID for verification

3. If the Health Factor is within 20% of the trigger threshold, warn the user:
   - Current HF and distance to trigger
   - Suggest reviewing the protection rule

4. If the daemon is stopped or paused, remind the user that protection is inactive.

5. Check `noctua-notifications.log` for any recent messages that haven't been relayed.
