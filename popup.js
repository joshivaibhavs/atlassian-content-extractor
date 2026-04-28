/**
 * Runs inside the page context (via chrome.scripting.executeScript).
 * Clones the <article> element, strips the recommendations wrapper,
 * fetches all <img> sources, converts them to base64, rewrites their
 * src attributes to relative `images/<filename>` paths, and returns
 * the HTML string, page title, and image data.
 *
 * @returns {Promise<{ html: string, title: string, images: Array<{filename:string,base64:string,mimeType:string}> } | null>}
 */
async function extractArticle() {
  const article = document.querySelector("article");
  if (!article) return null;

  const clone = article.cloneNode(true);

  const recommendations = clone.querySelector(
    '[data-vc="eop-recommendations-wrapper"]'
  );
  if (recommendations) {
    recommendations.remove();
  }

  // Collect all img elements that have a non-data src
  const imgElements = Array.from(clone.querySelectorAll("img[src]")).filter(
    (img) => !img.getAttribute("src").startsWith("data:")
  );

  const images = [];

  await Promise.all(
    imgElements.map(async (img, index) => {
      const rawSrc = img.getAttribute("src");
      let absoluteUrl;
      try {
        const urlObj = new URL(rawSrc, window.location.href);
        // Strip fragment (everything after #) for CDN URLs
        absoluteUrl = urlObj.href.split("#")[0];
      } catch {
        return; // malformed URL — leave src unchanged
      }

      try {
        // Use credentials: "omit" for cross-origin CDN requests
        const response = await fetch(absoluteUrl, { credentials: "omit" });
        if (!response.ok) return;

        const blob = await response.blob();

        // Derive a safe file extension
        const urlPath = absoluteUrl.split("?")[0];
        const urlExt = urlPath.split(".").pop().toLowerCase();
        const knownExts = ["jpg", "jpeg", "png", "gif", "svg", "webp", "avif", "bmp"];
        const ext = knownExts.includes(urlExt)
          ? urlExt
          : (blob.type.split("/")[1] || "png").replace(/\+.*$/, ""); // e.g. "svg+xml" → "svg"

        const filename = `image-${index + 1}.${ext}`;

        // Convert blob to base64 in chunks to avoid call-stack limits
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const CHUNK = 8192;
        let binary = "";
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        const base64 = btoa(binary);

        // Rewrite src to relative path
        img.setAttribute("src", `images/${filename}`);

        images.push({ filename, base64, mimeType: blob.type });
      } catch {
        // Network / CORS failure — leave original src in place
      }
    })
  );

  return {
    html: clone.outerHTML,
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
  Download as ZIP`;

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

function setStatus(type, message) {
  statusBox.className = `status-row ${type}`;
  statusMsg.textContent = message;
}

function showDownloadButton() {
  downloadArea.style.display = "block";
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

  // 1. Domain check — must be *.atlassian.net
  if (!url.hostname.endsWith(".atlassian.net")) {
    setStatus(
      "disabled",
      "Extension is disabled. Navigate to an Atlassian Confluence site (*.atlassian.net) to use this extension."
    );
    return;
  }

  // 2. Path check — must include /wiki/spaces
  if (!url.pathname.includes("/wiki/spaces")) {
    setStatus(
      "warning",
      "Not a wiki page. Navigate to a Confluence wiki page (/wiki/spaces/…) to extract content."
    );
    return;
  }

  // 3. Valid wiki page — ready to extract
  setStatus("ready", "Confluence wiki page detected. Ready to extract.");
  showDownloadButton();

  document.getElementById("downloadBtn").addEventListener("click", async () => {
    const btn = document.getElementById("downloadBtn");
    btn.disabled = true;
    btn.textContent = "Extracting…";

    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractArticle,
      });

      if (!result?.result) {
        setStatus(
          "error",
          "Could not find an <article> element on this page."
        );
        resetBtn(btn);
        return;
      }

      const { html, title, images } = result.result;
      const slug = toSlug(title) || "confluence-page";

      btn.textContent = `Bundling ${images.length} image(s)…`;

      const zip = new JSZip();

      // Wrap the article HTML in a minimal HTML document
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

      // Convert HTML to Markdown using Turndown
      const turndownService = new TurndownService();
      const markdown = turndownService.turndown(html);
      const fullMarkdown = `# ${escapeMarkdown(title)}\n\n${markdown}`;
      zip.file("index.md", fullMarkdown);

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
