# Atlassian Content Extractor

Chrome extension for exporting content from Atlassian Cloud pages.

The extension currently supports:

- Confluence wiki pages
- Jira issue pages

It extracts the visible page content from the active tab and downloads it as clean Markdown, plus HTML when exporting Confluence pages. Images referenced in the exported content are bundled alongside the output when available.

## Features

- Export Confluence wiki pages from `*.atlassian.net/wiki/spaces/...`
- Export Jira issues from `*.atlassian.net/browse/ISSUE-123`
- Generate Markdown output for both Confluence and Jira
- Generate standalone HTML for Confluence exports
- Download referenced images into an `images/` folder inside the export bundle
- Run directly in the browser with no backend service

## How It Works

The popup detects whether the active tab is a supported Atlassian page.

- On Confluence pages, it clones the main article content and exports:
	- `index.md`
	- `index.html`
	- `images/...` when images are detected
- On Jira issue pages, it targets the issue description area and exports:
	- `issue.md` when no images are present
	- a `.zip` containing `issue.md` and `images/...` when images are present

Exports are generated locally in the browser using the active page content.

## Installation

This repository is currently set up as an unpacked Chrome extension.

1. Clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select this repository folder.

After loading, pin the extension if you want quicker access from the toolbar.

## Usage

1. Open a supported Confluence or Jira page in Atlassian Cloud.
2. Click the extension icon.
3. Confirm the popup shows the page as supported.
4. Click Download content.
5. Open the downloaded Markdown file or ZIP archive.

## Permissions

The extension requests the minimum Chrome permissions it needs to operate:

- `activeTab` to access the currently selected page
- `scripting` to run extraction logic in the page context
- `*://*.atlassian.net/*` host access for Atlassian Cloud pages

## Project Structure

- `manifest.json`: Chrome extension manifest
- `popup.html`: popup UI
- `popup.js`: extraction, export, and download logic
- `vendor/jszip.min.js`: ZIP archive generation
- `vendor/turndown.js`: HTML to Markdown conversion
- `agentFiles/add-jira-tasks.md`: implementation note for Jira export support

## Development

There is no build step.

To make changes:

1. Edit the source files directly.
2. Reload the extension from `chrome://extensions`.
3. Reopen the popup and test against live Atlassian pages.

## Limitations

- Only Atlassian Cloud pages under `*.atlassian.net` are supported
- Jira export currently focuses on the issue description content
- Atlassian UI changes may require selector updates in the extractor
- Image fetching depends on the image being reachable from the page context

## Privacy

The extension performs extraction in the browser on the current page. This repository does not include any server-side component or remote upload flow.

## License and Disclaimer

This repository is made available on an "as is" basis, without warranties or conditions of any kind, express or implied, including without limitation any warranties of merchantability, fitness for a particular purpose, non-infringement, availability, accuracy, or reliability.

By using this software, you accept that you do so at your own risk. The authors and contributors accept no responsibility or liability for any claim, loss, damage, or other obligation arising from the use of this repository or the software distributed from it, including direct, indirect, incidental, consequential, special, exemplary, or financial damages.

If you publish this repository, add a dedicated `LICENSE` file with terms that match this section.

## Contributing

Issues and pull requests are welcome. If you plan to add support for additional Atlassian page types, include the target URL pattern and the DOM selectors used for extraction in your proposal.
