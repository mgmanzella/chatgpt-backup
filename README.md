# Backup your ChatGPT conversations

A single client side script to backup your entire conversation history on [chat.openai.com](https://chat.openai.com). The output is a single JSON file of your history.

## Preview backups with `index.html`

1. Clone the repo: `git clone https://github.com/abacaj/chatgpt-backup.git`
2. Open `index.html` in your browser (or serve folder with `python3 -m http.server 8000`)
3. Open `http://localhost:8000` in your browser
4. The viewer attempts to auto-load the newest `gpt-backup-*.json` in the folder when possible
5. If auto-load fails, use the file picker in the top left

![Preview](assets/preview.png)

## How to use

1. Visit https://chat.openai.com
2. Make sure you are logged in
3. Open chrome console or firefox console (F12 on keyboard)
4. Click on "Console" tab
5. Copy the entire script content found in file backup.js and paste into the console input field at the bottom
6. Press enter, script starts and logs detailed progress to the console
   ![Progress](assets/progress.png)
7. If it fails at any point, use the logs to see page/offset/request details and any failed conversation IDs
8. You can run from any offset by adjusting the script offsets found at the bottom of the script:

```js
const START_OFFSET = 0;
const STOP_OFFSET = -1;
```

## What's new in this version

- Pagination now continues by requesting pages until the API returns no more items (instead of trusting a possibly capped `total` from the first page)
- Per-conversation fetch errors no longer abort the whole run
- Failed conversation IDs are collected and exported to `gpt-backup-failed-<timestamp>.json`
- Checkpoints are saved during execution in `localStorage` under key `gpt_backup_checkpoint_v1`
- Added verbose logs for:
  - ID page requests/responses
  - aggregate/unique counts
  - per-conversation fetch attempts
  - checkpoint/success/failure counters
  - final summary

## How it works

This uses the same frontend API that is used by your client browser.

## Benefits

Some of the key benefits:

- Nothing to download or install
- Tested on chrome, firefox
- Fully client side, single script, copy paste to run
- Respects rate limits
- Fails early
- Adjust offsets if you have many conversations, ex. start at 0 to 500, then run 500 to 1000
- **Fully auditable code in the backup.js file, no third parties**

## Use cases

- Backup your conversation history offline
- The model output from the current OAI terms state that they belong to you
- Useful if you need to look back when the service is down
- Intended as a read-only backup (the ids aren't stored)

## Notes

- Tested with 700+ conversations
- Current rate is 60 conversations/minute
- Roughly 10 minutes for 600 conversations
- Roughly 1 hour for 6000 conversations
- This is to respect the OAI API rate limits
- Keep your browser tab open, you don't need it to be focused for this to finish
- Chrome **may** prompt you to download the file once it's completed
- Tested on firefox, requires you to type `allow pasting` before you can paste the script
- A run can produce two files:
  - `gpt-backup-<timestamp>.json` (successful conversations)
  - `gpt-backup-failed-<timestamp>.json` (only if some conversations failed)

## Troubleshooting

- If output seems truncated, check:
  - `GPT-BACKUP::IDS::SUMMARY::...`
  - `GPT-BACKUP::SUMMARY::...`
- If there are failures, inspect the downloaded `gpt-backup-failed-*.json` for IDs and offsets
- If `index.html` does not auto-load a backup:
  - open the JSON manually with the file picker, or
  - run a local server (`python3 -m http.server 8000`) and open `http://localhost:8000`

## Contributors

- [@FredySandoval](https://github.com/FredySandoval) - Preview backups feature
