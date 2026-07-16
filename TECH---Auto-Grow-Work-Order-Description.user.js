// ==UserScript==
// @name         TECH - Auto Grow Work Order Description
// @namespace    http://tampermonkey.net/
// @version      2.0
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Auto-Grow-Work-Order-Description.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Auto-Grow-Work-Order-Description.user.js
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// @run-at       document-end
// ==/UserScript==
(function () {
    'use strict';
    var MIN_HEIGHT = 233;

    // Textareas to auto-grow — matched by label text, with hardcoded ID fallback
    var TEXTAREA_FIELDS = [
        { labelPatterns: ["Work Order Description"], fallbackId: "AerospaceHead_WorkOrderDesc" }
    ];

    // Read-only spans to style — matched by label text, with hardcoded index fallback
    var SPAN_FIELDS = [
        { labelText: "Work Performed", fallbackIndex: 10 },
        { labelText: "Manufacturer", fallbackIndex: 11 },
        { labelText: "Pre Data", fallbackIndex: 12 },
        { labelText: "Post Data", fallbackIndex: 13 }
    ];

    // ── Label-based discovery ──

    function findTextareaByLabel(labelPatterns) {
        var labels = document.querySelectorAll("label.control-label");
        for (var i = 0; i < labels.length; i++) {
            var text = labels[i].textContent.trim();
            for (var j = 0; j < labelPatterns.length; j++) {
                if (text.indexOf(labelPatterns[j]) !== -1) {
                    var tr = labels[i].closest("tr");
                    if (tr) {
                        var ta = tr.querySelector("textarea");
                        if (ta) return ta;
                    }
                }
            }
        }
        return null;
    }

    function findSpanByLabel(labelText) {
        var labels = document.querySelectorAll("label.control-label");
        for (var i = 0; i < labels.length; i++) {
            if (labels[i].textContent.trim().indexOf(labelText) !== -1) {
                var td = labels[i].closest("tr");
                if (td) td = td.querySelector("td");
                if (!td) continue;
                var span = td.querySelector("span:not(.field-validation-valid):not(.text-danger)");
                if (span) return span;
            }
        }
        return null;
    }

    // ── Core logic ──

    function autoGrow(textarea) {
        if (!textarea) return;
        textarea.style.height = "auto";
        var newHeight = Math.max(textarea.scrollHeight, MIN_HEIGHT);
        textarea.style.height = newHeight + "px";
    }

    function attachTextarea(textarea) {
        if (!textarea || textarea.dataset.autoGrowAttached) return;
        textarea.dataset.autoGrowAttached = "1";
        textarea.style.resize = "vertical";
        textarea.style.overflow = "hidden";
        textarea.style.minHeight = MIN_HEIGHT + "px";
        autoGrow(textarea);
        textarea.addEventListener("input", function () {
            autoGrow(textarea);
        });
    }

    function attachSpan(span) {
        if (!span) return;
        span.style.display = "block";
        span.style.whiteSpace = "pre";
        span.style.fontFamily = "monospace";
        span.style.overflowX = "auto";
        span.dataset.autoGrowAttached = "1";
    }

    function init() {
        // Textareas — label-based lookup with fallback
        TEXTAREA_FIELDS.forEach(function (field) {
            var ta = findTextareaByLabel(field.labelPatterns);
            if (!ta && field.fallbackId) ta = document.getElementById(field.fallbackId);
            attachTextarea(ta);
        });

        // Spans — label-based lookup with fallback
        SPAN_FIELDS.forEach(function (field) {
            var span = findSpanByLabel(field.labelText);
            if (!span && field.fallbackIndex !== undefined) {
                var hiddenLabel = document.getElementById("OrderHead_CustomFields_" + field.fallbackIndex + "__Label");
                if (hiddenLabel) {
                    var td = hiddenLabel.closest("td");
                    if (td) span = td.querySelector("span:not(.field-validation-valid):not(.text-danger)");
                }
            }
            attachSpan(span);
        });
    }

    function anyPresent() {
        var textareaPresent = TEXTAREA_FIELDS.some(function (field) {
            if (findTextareaByLabel(field.labelPatterns)) return true;
            if (field.fallbackId && document.getElementById(field.fallbackId)) return true;
            return false;
        });
        var spanPresent = SPAN_FIELDS.some(function (field) {
            if (findSpanByLabel(field.labelText)) return true;
            if (field.fallbackIndex !== undefined && document.getElementById("OrderHead_CustomFields_" + field.fallbackIndex + "__Label")) return true;
            return false;
        });
        return textareaPresent || spanPresent;
    }

    window.addEventListener("DOMContentLoaded", init);
    if (window.TechShared) {
        TechShared.observer.register(function () {
            if (!anyPresent()) return;
            init();
        }, { debounce: 200 });
    } else {
        var observer = new MutationObserver(function () {
            if (!anyPresent()) return;
            init();
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
})();
