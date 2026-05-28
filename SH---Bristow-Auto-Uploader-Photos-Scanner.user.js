// ==UserScript==
// @name         SH - Bristow Auto-Uploader (Photos + Scanner)
// @namespace    http://tampermonkey.net/
// @version      2.3
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/SH---Bristow-Auto-Uploader-Photos-Scanner.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/SH---Bristow-Auto-Uploader-Photos-Scanner.user.js
// @description  Auto-uploads phone photos AND scanned PDFs into the Bristow file uploader
// @author       You
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════════
  // ⚙️ CONFIGURATION
  // ═══════════════════════════════════════════════════════════════
  const SERVER_IP   = "192.168.50.9"; //change to the correct ip of the computer
  const SERVER_PORT = 3333;
  const POLL_MS     = 4000;

  // Photo compression settings — tweak if needed
  const PHOTO_MAX_PX      = 1920;   // longest edge in pixels
  const PHOTO_JPEG_QUALITY = 0.82;  // 0–1  (0.82 ≈ 85% quality)
  // ═══════════════════════════════════════════════════════════════

  const SERVER_BASE = `https://${SERVER_IP}:${SERVER_PORT}`;

  // ──────────────────────────────────────────────────────────────
  // Normalize order numbers
  // ──────────────────────────────────────────────────────────────
  function normalizeOrderNumber(str) {

    if (!str) return null;

    return str
      .replace(/[_\s]+/g, "-")
      .replace(/--+/g, "-")
      .toUpperCase()
      .trim();
  }

  // ──────────────────────────────────────────────────────────────
  // Extract order number from page
  // ──────────────────────────────────────────────────────────────
  function getOrderNumber() {
    const labels = document.querySelectorAll("label.custom-header-col");

    for (const label of labels) {
      const text = label.textContent || "";

      // Matches OC-BRI-307781 style: OC + 2-5 letters + 4-8 digits
      const match = text.match(/\b(OC[-_\s][A-Z]{2,5}[-_\s]\d{4,8})\b/i);

      if (match) {
        return normalizeOrderNumber(match[1]);
      }
    }

    return null;
  }

  // ──────────────────────────────────────────────────────────────
  // Load external script
  // ──────────────────────────────────────────────────────────────
  function loadScript(src, cb) {

    const s = document.createElement("script");

    s.src = src;
    s.onload = cb;

    document.head.appendChild(s);
  }

  // ──────────────────────────────────────────────────────────────
  // Photo compression
  //   Accepts a File or Blob (image/jpeg or image/png etc.)
  //   Returns a Promise<File> compressed to JPEG
  // ──────────────────────────────────────────────────────────────
  function compressPhoto(file) {
    return new Promise((resolve, reject) => {

      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);

        // Calculate new dimensions, capping the longest edge at PHOTO_MAX_PX
        let { width, height } = img;

        if (width > PHOTO_MAX_PX || height > PHOTO_MAX_PX) {
          if (width >= height) {
            height = Math.round((height / width) * PHOTO_MAX_PX);
            width  = PHOTO_MAX_PX;
          } else {
            width  = Math.round((width / height) * PHOTO_MAX_PX);
            height = PHOTO_MAX_PX;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width  = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              // If compression fails for any reason, fall back to the original
              console.warn("[BristowRelay] Compression failed, using original");
              resolve(file);
              return;
            }

            // Keep the original filename but force .jpg extension
            const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
            resolve(new File([blob], name, { type: "image/jpeg" }));
          },
          "image/jpeg",
          PHOTO_JPEG_QUALITY
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        // Not a recognised image — pass through unchanged (e.g. HEIC edge-cases)
        console.warn("[BristowRelay] Could not decode image, using original");
        resolve(file);
      };

      img.src = url;
    });
  }

  // ──────────────────────────────────────────────────────────────
  // Build floating panel
  // ──────────────────────────────────────────────────────────────
  function buildPanel() {

    const currentOrder = getOrderNumber();

    const panel = document.createElement("div");

    panel.id = "bristow-relay-panel";

    panel.innerHTML = `
      <style>

        #bristow-relay-panel {
          position: fixed;
          bottom: 24px;
          right: 24px;
          width: 230px;
          background: #1e1e2e;
          border-radius: 16px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.45);
          padding: 16px;
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: #cdd6f4;
          user-select: none;
        }

        #bristow-relay-panel h3 {
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #89b4fa;
          margin: 0 0 4px 0;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        #br-order-label {
          font-size: 0.7rem;
          color: #585b70;
          margin-bottom: 10px;
        }

        #br-order-label span {
          color: #a6e3a1;
          font-weight: 700;
        }

        .br-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #a6e3a1;
          display: inline-block;
          animation: blink 1.4s ease-in-out infinite;
          flex-shrink: 0;
        }

        .br-dot.error {
          background: #f38ba8;
          animation: none;
        }

        @keyframes blink {
          0%,100% { opacity:1 }
          50% { opacity:0.3 }
        }

        #br-qr {
          background: #fff;
          border-radius: 10px;
          padding: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 8px;
        }

        #br-status {
          font-size: 0.7rem;
          color: #a6adc8;
          text-align: center;
          line-height: 1.5;
          min-height: 2em;
        }

        .br-badge {
          display: inline-block;
          background: #313244;
          border-radius: 20px;
          padding: 2px 10px;
          margin-top: 4px;
          color: #a6e3a1;
          font-weight: 700;
          font-size: 0.75rem;
        }

        #br-tabs {
          display: flex;
          gap: 4px;
          margin-bottom: 8px;
        }

        .br-tab {
          flex: 1;
          padding: 5px 0;
          border-radius: 8px;
          border: none;
          font-size: 0.68rem;
          font-weight: 700;
          cursor: pointer;
          background: #313244;
          color: #585b70;
        }

        .br-tab.active {
          background: #45475a;
          color: #cdd6f4;
        }

        #br-minimize {
          position: absolute;
          top: 10px;
          right: 12px;
          background: none;
          border: none;
          color: #585b70;
          font-size: 1rem;
          cursor: pointer;
          line-height: 1;
          padding: 0;
        }

        #br-minimize:hover {
          color: #cdd6f4;
        }

        #bristow-relay-panel.minimized .br-body {
          display: none;
        }

        #bristow-relay-panel.minimized {
          width: auto;
          padding: 10px 14px;
        }

        #br-unclaimed-toast {
          display: none;
          position: fixed;
          bottom: 290px;
          right: 24px;
          background: #f38ba8;
          color: #1e1e2e;
          border-radius: 12px;
          padding: 12px 16px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 0.82rem;
          font-weight: 700;
          z-index: 999998;
          box-shadow: 0 4px 16px rgba(0,0,0,0.3);
          max-width: 230px;
          line-height: 1.4;
        }

        #br-unclaimed-toast button {
          margin-top: 8px;
          padding: 4px 12px;
          border-radius: 8px;
          border: none;
          background: #1e1e2e;
          color: #fff;
          font-size: 0.75rem;
          cursor: pointer;
          margin-right: 6px;
        }

      </style>

      <div id="br-unclaimed-toast"></div>

      <button id="br-minimize" title="Minimize">⌄</button>

      <h3>
        <span class="br-dot" id="br-dot"></span>
        Bristow Uploader
      </h3>

      <div id="br-order-label">
        Order: <span>${currentOrder || "Not detected"}</span>
      </div>

      <div class="br-body">

        <div id="br-tabs">
          <button class="br-tab active" id="br-tab-photo">
            📷 Phone
          </button>

          <button class="br-tab" id="br-tab-scan">
            🖨️ Scanner
          </button>
        </div>

        <div id="br-panel-photo">

          <div id="br-qr"></div>

          <div id="br-status-photo">
            Scan QR with your phone<br>

            <small style="color:#585b70">
              Same Wi-Fi required
            </small>
          </div>

        </div>

        <div id="br-panel-scan" style="display:none">

          <div
            id="br-status-scan"
            style="
              text-align:center;
              padding:8px 0;
              font-size:0.72rem;
              color:#a6adc8;
              line-height:1.5;
            "
          >

            Watching
            <strong style="color:#cdd6f4">
              C:\\WOScans
            </strong>

            <br>

            for new PDFs…

            <br>

            <small style="color:#585b70">
              Scans matching this order
              <br>
              will upload automatically
            </small>

          </div>

        </div>

        <div id="br-status" style="margin-top:6px"></div>

      </div>
    `;

    document.body.appendChild(panel);

    // Tabs
    const photoBtn =
      document.getElementById("br-tab-photo");

    const scanBtn =
      document.getElementById("br-tab-scan");

    photoBtn.addEventListener("click", () => {

      document.getElementById("br-panel-photo").style.display = "";
      document.getElementById("br-panel-scan").style.display  = "none";

      photoBtn.classList.add("active");
      scanBtn.classList.remove("active");
    });

    scanBtn.addEventListener("click", () => {

      document.getElementById("br-panel-photo").style.display = "none";
      document.getElementById("br-panel-scan").style.display  = "";

      photoBtn.classList.remove("active");
      scanBtn.classList.add("active");
    });

    // Minimize
    let minimized = false;

    document
      .getElementById("br-minimize")
      .addEventListener("click", () => {

        minimized = !minimized;

        panel.classList.toggle("minimized", minimized);

        document.getElementById("br-minimize").textContent =
          minimized ? "⌃" : "⌄";
      });
  }

  // ──────────────────────────────────────────────────────────────
  // Render QR
  // ──────────────────────────────────────────────────────────────
  function renderQR() {

    const el = document.getElementById("br-qr");

    if (!el) return;

    el.innerHTML = "";

    const currentOrder = getOrderNumber();

    const uploadUrl = currentOrder
      ? `${SERVER_BASE}/upload?wo=${encodeURIComponent(currentOrder)}`
      : `${SERVER_BASE}/upload`;

    new QRCode(el, {
      text: uploadUrl,
      width: 190,
      height: 190,
      colorDark: "#1e1e2e",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
  }

  // ──────────────────────────────────────────────────────────────
  // Status helpers
  // ──────────────────────────────────────────────────────────────
  let totalPhotos = 0;
  let totalScans  = 0;

  function setMainStatus(msg) {

    const el =
      document.getElementById("br-status");

    if (el) el.innerHTML = msg;
  }

  function setDot(ok) {

    const dot =
      document.getElementById("br-dot");

    if (dot) {
      dot.classList.toggle("error", !ok);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Base64 -> File
  // ──────────────────────────────────────────────────────────────
  function base64ToFile(b64, name, type) {

    const binary = atob(b64);

    const bytes  = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new File([bytes], name, { type });
  }

  // ──────────────────────────────────────────────────────────────
  // Inject files into uploader
  // ──────────────────────────────────────────────────────────────
  function injectFiles(files, label) {

    const input =
      document.getElementById("files");

    if (!input) {

      console.warn(
        "[BristowRelay] #files input not found"
      );

      return;
    }

    const dt = new DataTransfer();

    files.forEach(f => dt.items.add(f));

    input.files = dt.files;

    input.dispatchEvent(
      new Event("change", { bubbles: true })
    );

    setTimeout(() => {

      try {

        const ku =
          $(input).data("kendoUpload");

        if (ku) ku.upload();

      } catch {}

    }, 250);

    if (label === "photo") {

      totalPhotos += files.length;

      setMainStatus(`
        <span class="br-badge">
          ✅ ${totalPhotos} photo(s) uploaded
        </span>
      `);

    } else {

      totalScans += files.length;

      setMainStatus(`
        <span class="br-badge">
          📄 ${totalScans} scan(s) uploaded
        </span>
      `);
    }

    setTimeout(() => {
      setMainStatus("");
    }, 5000);
  }

  // ──────────────────────────────────────────────────────────────
  // Unclaimed scans
  // ──────────────────────────────────────────────────────────────
  function showUnclaimedToast(scans) {

    const toast =
      document.getElementById("br-unclaimed-toast");

    if (!toast) return;

    toast.style.display = "block";

    toast.innerHTML = `
      ⚠️ ${scans.length} scan(s) found with no matching order number.
      <br>
      Upload to <strong>this order</strong>?
      <br>

      <button id="br-unclaimed-yes">
        Yes, upload here
      </button>

      <button id="br-unclaimed-no">
        Dismiss
      </button>
    `;

    document.getElementById("br-unclaimed-yes").onclick = () => {

      const files = scans.map(s =>
        base64ToFile(s.dataBase64, s.name, s.type)
      );

      injectFiles(files, "scan");

      toast.style.display = "none";
    };

    document.getElementById("br-unclaimed-no").onclick = () => {
      toast.style.display = "none";
    };
  }

  // ──────────────────────────────────────────────────────────────
  // Polling
  // ──────────────────────────────────────────────────────────────
  let polling = false;

  async function poll() {

    if (polling) return;

    polling = true;

    try {

      const currentOrder = getOrderNumber();

      // Update order label live
      const orderLabel =
        document.querySelector("#br-order-label span");

      if (orderLabel) {
        orderLabel.textContent =
          currentOrder || "Not detected";
      }

      // Refresh QR with current WO
      renderQR();

      // ── Phone photos ─────────────────────────────────────────
      const photoRes = await fetch(
        `${SERVER_BASE}/poll`,
        { cache: "no-store" }
      );

      const photoData =
        await photoRes.json();

      setDot(true);

      if (
        photoData.photos &&
        photoData.photos.length > 0
      ) {

        // Convert base64 → File, then compress each photo before injecting
        const rawFiles = photoData.photos.map(p =>
          base64ToFile(p.dataBase64, p.name, p.type)
        );

        setMainStatus(`
          <span style="color:#cba6f7;font-size:0.7rem">
            ⏳ Compressing ${rawFiles.length} photo(s)…
          </span>
        `);

        const compressed = await Promise.all(
          rawFiles.map(f => compressPhoto(f))
        );

        injectFiles(compressed, "photo");
      }

      // ── Scans ────────────────────────────────────────────────
      if (currentOrder) {

        const scanRes = await fetch(
          `${SERVER_BASE}/poll-scans?order=${encodeURIComponent(currentOrder)}`,
          { cache: "no-store" }
        );

        const scanData =
          await scanRes.json();

        if (
          scanData.scans &&
          scanData.scans.length > 0
        ) {

          console.log(
            `[BristowRelay] Auto-uploading ${scanData.scans.length} scan(s) for ${currentOrder}`
          );

          const files = scanData.scans.map(s =>
            base64ToFile(
              s.dataBase64,
              s.name,
              s.type
            )
          );

          injectFiles(files, "scan");
        }

        if (
          scanData.unclaimed &&
          scanData.unclaimed.length > 0
        ) {
          showUnclaimedToast(scanData.unclaimed);
        }
      }

    } catch (e) {

      setDot(false);

      setMainStatus(`
        <span style="color:#f38ba8;font-size:0.7rem">
          ⚠️ Server unreachable
        </span>
      `);

    } finally {

      polling = false;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Boot
  // ──────────────────────────────────────────────────────────────
  function init() {

    buildPanel();

    loadScript(
      "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
      () => {

        renderQR();

        setInterval(poll, POLL_MS);

        poll();
      }
    );
  }

  if (document.readyState === "loading") {

    document.addEventListener(
      "DOMContentLoaded",
      init
    );

  } else {

    init();
  }

})();