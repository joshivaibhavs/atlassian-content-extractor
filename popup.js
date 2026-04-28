/**
 * @typedef {{ filename: string, base64: string, mimeType: string }} ExportImage
 */

/**
 * Fetches images in an element, rewrites img src to images/<filename>,
 * and returns the image payloads for bundling.
 *
 * @param {Element} root
 * @returns {Promise<ExportImage[]>}
 */
async function collectImagesAndRewriteSrc(root) {
  const imgElements = Array.from(root.querySelectorAll("img[src]")).filter((img) => {
    const src = img.getAttribute("src") || "";
    return src && !src.startsWith("data:");
  });

  const images = [];

  await Promise.all(
    imgElements.map(async (img, index) => {
      const rawSrc = img.getAttribute("src");
      let absoluteUrl;

      try {
        const urlObj = new URL(rawSrc, window.location.href);
        absoluteUrl = urlObj.href.split("#")[0];
      } catch {
        return;
      }

      try {
        const response = await fetch(absoluteUrl, { credentials: "omit" });
        if (!response.ok) return;

        const blob = await response.blob();

        const urlPath = absoluteUrl.split("?")[0];
        const urlExt = (urlPath.split(".").pop() || "").toLowerCase();
        const knownExts = ["jpg", "jpeg", "png", "gif", "svg", "webp", "avif", "bmp"];
        const ext = knownExts.includes(urlExt)
          ? urlExt
          : (blob.type.split("/")[1] || "png").replace(/\+.*$/, "");

        const filename = `image-${index + 1}.${ext}`;

        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const CHUNK = 8192;
        let binary = "";

        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }

        const base64 = btoa(binary);
        img.setAttribute("src", `images/${filename}`);
        images.push({ filename, base64, mimeType: blob.type });
      } catch {
        // Keep original src when image fetch fails.
      }
    })
  );

  return images;
}

/**
 * Runs inside the page context (via chrome.scripting.executeScript).
 * Clones the <article> element, strips the recommendations wrapper,
 * and returns cleaned html/title/images.
 *
 * @returns {Promise<{ html: string, title: string, images: ExportImage[] } | null>}
 */
async function extractArticle() {
  const article = document.querySelector("article");
  if (!article) return null;

  const clone = article.cloneNode(true);

  const recommendations = clone.querySelector('[data-vc="eop-recommendations-wrapper"]');
  if (recommendations) {
    recommendations.remove();
  }

  const images = await collectImagesAndRewriteSrc(clone);

  return {
    html: clone.outerHTML,
    title: document.title,
    images,
  };
}

/**
 * Runs inside Jira issue pages. Uses the parent of #jira-issue-header,
 * and prefers the description field when available.
 *
 * @returns {Promise<{ html: string, title: string, images: ExportImage[] } | null>}
 */
async function extractJiraIssue() {
  const issueHeader = document.getElementById("jira-issue-header");
  if (!issueHeader || !issueHeader.parentElement) return null;

  const rootClone = issueHeader.parentElement.cloneNode(true);

  const descriptionSelectors = [
    '[data-testid="issue.views.field.rich-text.description"]',
    '[data-testid="issue.views.field.description.description-container"]',
    '[data-testid="issue.views.field.description"]',
  ];

  let target = null;
  for (const selector of descriptionSelectors) {
    const node = rootClone.querySelector(selector);
    if (node) {
      target = node;
      break;
    }
  }

  if (!target) {
    target = rootClone;
  }

  const images = await collectImagesAndRewriteSrc(target);

  return {
    html: target.outerHTML,
    title: document.title,
    images,
  };
}

/**
 * Converts a string into a URL-friendly slug.
 * @param {string} text
 * @returns {string}
 */
function toSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * Escapes a string for safe use inside HTML attribute values / text nodes.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Escapes special Markdown characters to prevent unintended formatting.
 * @param {string} text
 * @returns {string}
 */
function escapeMarkdown(text) {
  return text.replace(/([\\`*_{}\[\]()#+\-.!])/g, "\\$1");
}

const DOWNLOAD_BTN_INNER = `
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 2v8m0 0L5 7m3 3l3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  Download content`;

/**
 * Resets the download button to its idle state.
 * @param {HTMLButtonElement} btn
 */
function resetBtn(btn) {
  btn.disabled = false;
  btn.innerHTML = DOWNLOAD_BTN_INNER;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

const statusBox = document.getElementById("statusBox");
const statusMsg = document.getElementById("statusMsg");
const downloadArea = document.getElementById("downloadArea");
const downloadBtn = document.getElementById("downloadBtn");

function setStatus(type, message) {
  statusBox.className = `status-row ${type}`;
  statusMsg.textContent = message;
}

function showDownloadButton() {
  downloadArea.style.display = "block";
}

/**
 * @param {URL} url
 * @returns {{ mode: "confluence" | "jira" | null, reason?: string }}
 */
function detectPageMode(url) {
  if (!url.hostname.endsWith(".atlassian.net")) {
    return {
      mode: null,
      reason:
        "Extension is disabled. Navigate to an Atlassian site (*.atlassian.net) to use this extension.",
    };
  }

  if (url.pathname.includes("/wiki/spaces")) {
    return { mode: "confluence" };
  }

  if (/^\/browse\/[^/]+$/.test(url.pathname)) {
    return { mode: "jira" };
  }

  return {
    mode: null,
    reason: "Supported pages: Confluence wiki pages and Jira issue pages (/browse/ISSUE-123).",
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Guard: tab URL may be undefined for special pages (e.g. chrome://)
  let url;
  try {
    url = new URL(tab.url);
  } catch {
    setStatus("disabled", "Cannot inspect this page.");
    return;
  }

  const detection = detectPageMode(url);
  if (!detection.mode) {
    setStatus("warning", detection.reason || "Unsupported page.");
    return;
  }

  const pageMode = detection.mode;
  if (pageMode === "confluence") {
    setStatus("ready", "Confluence wiki page detected. Ready to extract.");
  } else {
    setStatus("ready", "Jira issue page detected. Ready to export markdown.");
  }

  showDownloadButton();

  downloadBtn.addEventListener("click", async () => {
    const btn = document.getElementById("downloadBtn");
    btn.disabled = true;
    btn.textContent = "Extracting…";

    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: pageMode === "jira" ? extractJiraIssue : extractArticle,
      });

      if (!result?.result) {
        setStatus("error", "Could not find exportable content on this page.");
        resetBtn(btn);
        return;
      }

      const { html, title, images } = result.result;
      const slug = toSlug(title) || "confluence-page";

      const turndownService = new TurndownService();
      const markdown = turndownService.turndown(html);
      const fullMarkdown = `# ${escapeMarkdown(title)}\n\n${markdown}`;

      if (pageMode === "jira" && images.length === 0) {
        const mdBlob = new Blob([fullMarkdown], { type: "text/markdown;charset=utf-8" });
        const mdUrl = URL.createObjectURL(mdBlob);

        const mdAnchor = document.createElement("a");
        mdAnchor.href = mdUrl;
        mdAnchor.download = `${slug}.md`;
        mdAnchor.click();

        setTimeout(() => URL.revokeObjectURL(mdUrl), 1000);
        btn.textContent = "Downloaded!";
        return;
      }

      btn.textContent = `Bundling ${images.length} image(s)…`;

      const zip = new JSZip();
      zip.file(pageMode === "jira" ? "issue.md" : "index.md", fullMarkdown);

      if (pageMode === "confluence") {
        const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
</head>
<body>
${html}
</body>
</html>`;
        zip.file("index.html", fullHtml);
      }

      if (images.length > 0) {
        const imgFolder = zip.folder("images");
        for (const { filename, base64, mimeType } of images) {
          imgFolder.file(filename, base64, { base64: true, comment: mimeType });
        }
      }

      const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const objectUrl = URL.createObjectURL(zipBlob);

      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${slug}.zip`;
      anchor.click();

      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

      btn.textContent = "Downloaded!";
    } catch (err) {
      setStatus("error", `Failed to extract content: ${err.message}`);
      resetBtn(btn);
    }
  });
});
