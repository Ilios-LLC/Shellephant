cd window-manager
npm i
npm run dev

## Conversation Summarization (DISABLED)

The async Stop hook that summarizes each conversation (title + bullet points) is **currently disabled**.
All plumbing is intact — the hook in `files/claude-settings.json`, the poller, the IPC, and the renderer store.
Only the script exits early.

To re-enable: edit `files/claude-summarize.sh` and remove the two lines:
```bash
# DISABLED: conversation summarization is temporarily turned off.
exit 0
```
Then rebuild the container image (`docker build`) so `/usr/local/bin/claude-summarize.sh` picks up the change.