// ==UserScript==
// @name         ALL - Floating Text Blaze Box
// @namespace    http://tampermonkey.net/
// @version      1.3
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/ALL---Floating-Text-Blaze-Box.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/ALL---Floating-Text-Blaze-Box.user.js
// @description  Adds a floating textbox for Text Blaze
// @match        https://bristow-app.azurewebsites.net/*
// @grant        none
// @run-at       document-end
// ==/UserScript==
(function() {
  if (window.location.href.includes("/Orders/Jobs/Edit")) return;

  function addBox() {
    if (document.getElementById("tm-floating-box")) return;
    const box = document.createElement("textarea");
    box.id = "tm-floating-box";
    box.placeholder = "TYPE MACRO HERE";
    Object.assign(box.style, {
      position: "fixed",
      top: "5px",
      left: "190px",        // ✅ anchored to left edge of viewport
      width: "170px",
      height: "40px",
      zIndex: 2147483647,
      padding: "8px",
      fontSize: "13px",
      border: "2px solid #444",
      background: "#fff",
      color: "black"
    });
    document.body.appendChild(box);
  }

  window.addEventListener("DOMContentLoaded", addBox);
  const observer = new MutationObserver(function() {
    if (!document.getElementById("tm-floating-box")) addBox();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();