// ==UserScript==
// @name         TECH - Time Expanded Section Trimmed
// @namespace    http://tampermonkey.net/
// @version      2.3
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Time-Expanded-Section-Trimmed.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Time-Expanded-Section-Trimmed.user.js
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    if (window !== window.top) return;

    function findJobLink() {
        var link = document.querySelector("a.monospaced[href*='Orders/Jobs/Edit']");
        return link ? link.href : null;
    }

    function waitForJobLink() {
        return new Promise(function (resolve) {

            var existing = findJobLink();
            if (existing) return resolve(existing);

            var observer = new MutationObserver(function () {
                var link = findJobLink();
                if (link) {
                    observer.disconnect();
                    resolve(link);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            setTimeout(function () {
                observer.disconnect();
                resolve(null);
            }, 20000);
        });
    }

    // ---------------- REMOVE STUFF (IFRAME ONLY) ----------------
    function removeStuffFromIframe(iframe) {
        try {
            var doc = iframe.contentDocument || iframe.contentWindow.document;
            if (!doc) return;

            // --- REMOVE NAVBAR ---
            var navbar = doc.querySelector("nav.navbar");
            if (navbar) navbar.remove();

            // --- REMOVE JUMP BUTTON GROUP ---
            var jumpLinks = doc.querySelectorAll(
                'a[href="#HeaderTarget"], a[href="#AddPartTarget"], a[href="#RQsTarget"], a[href="#CommentsTarget"]'
            );

            jumpLinks.forEach(function (link) {
                var container = link.closest(".col-md-4");
                if (container) container.remove();
            });

            // --- REMOVE COMMENTS ---
            var commentsTarget = doc.getElementById("CommentsTarget");
            if (commentsTarget) {
                var section = commentsTarget.closest(".row.content-group");
                if (section) section.remove();
            }

            // --- REMOVE DESCRIPTION + NOTES ---
            var desc = doc.getElementById("HeaderInfo_Description");
            var notes = doc.getElementById("HeaderInfo_JobNotes");

            if (desc || notes) {
                var row = (desc || notes).closest(".row");
                if (row) row.remove();
            }

            // --- REMOVE PARTS TAB ---
            var partsTabLink = doc.querySelector('a[href="#partPicker"]');
            if (partsTabLink) {
                var li = partsTabLink.closest("li");
                if (li) li.remove();
            }

            var partsContent = doc.getElementById("partPicker");
            if (partsContent) partsContent.remove();

            // --- FORCE SERVICES ACTIVE ---
            var servicesTabLink = doc.querySelector('a[href="#servicePicker"]');
            var servicesContent = doc.getElementById("servicePicker");

            if (servicesTabLink) {
                var li = servicesTabLink.closest("li");
                if (li) li.classList.add("active");
                servicesTabLink.setAttribute("aria-expanded", "true");
            }

            if (servicesContent) {
                servicesContent.classList.add("active", "in");
            }

            // --- REMOVE ORDER LINE DETAILS ---
            doc.querySelectorAll("h5").forEach(function (h) {
                if (h.textContent.trim() === "Order Line Details") {
                    var row = h.closest(".row");
                    if (row) row.remove();
                }
            });

            // --- REMOVE SAVE BUTTON ---
            doc.querySelectorAll('input[type="submit"][value="Save"]').forEach(btn => btn.remove());

            // --- REMOVE DETAILED PDF BUTTON ---
            doc.querySelectorAll('a[href*="ReportGenerator/PrintPDF"]').forEach(btn => btn.remove());

            // --- REMOVE FOOTER ---
            var footer = doc.querySelector("footer");
            if (footer) footer.remove();

            // --- REMOVE UPLOADS SECTION ---
            doc.querySelectorAll("a.accordion-toggle").forEach(function (toggle) {
                if (toggle.textContent.trim() === "Uploads") {
                    var well = toggle.closest(".well.well-sm");
                    if (well) well.remove();
                }
            });

            // --- REMOVE ORDER TOTALS SECTION ---
            var orderSubtotal = doc.getElementById("OrderSubtotal");
            if (orderSubtotal) {
                var container = orderSubtotal.closest(".container-fluid");
                if (container) container.remove();
            }

        } catch (e) {
            console.warn("Iframe not ready or inaccessible");
        }
    }

    function watchIframe(iframe) {
        try {
            var doc = iframe.contentDocument || iframe.contentWindow.document;
            if (!doc) return;

            var observer = new MutationObserver(function () {
                removeStuffFromIframe(iframe);
            });

            observer.observe(doc.body, {
                childList: true,
                subtree: true
            });

            removeStuffFromIframe(iframe);

        } catch (e) {
            console.warn("Could not attach observer to iframe");
        }
    }

    function createTimeExpandedSection(jobUrl) {

        var anchor = document.querySelector("#OrderRowsSection");
        if (!anchor) return;

        if (document.getElementById("timeExpandedSection")) return;

        var section = document.createElement("div");
        section.className = "row content-group";
        section.id = "timeExpandedSection";
        section.style.marginTop = "20px";

        var col = document.createElement("div");
        col.className = "col-md-12";

        var well = document.createElement("div");
        well.className = "well well-sm";

        var h3 = document.createElement("h3");

        var toggle = document.createElement("a");
        toggle.innerText = "Time Expanded";
        toggle.className = "accordion-toggle collapsed";
        toggle.setAttribute("data-toggle", "collapse");

        var id = "collapseTimeExpanded";
        toggle.setAttribute("data-target", "#" + id);
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-controls", id);

        toggle.onmouseover = function () {
            this.style.cursor = "pointer";
        };

        h3.appendChild(toggle);

        var body = document.createElement("div");
        body.className = "row collapse";
        body.id = id;

        var inner = document.createElement("div");
        inner.className = "col-md-12";

        var iframe = document.createElement("iframe");
        iframe.src = jobUrl;
        iframe.style.width = "100%";
        iframe.style.height = "1250px";
        iframe.style.border = "1px solid #ccc";
        iframe.style.borderRadius = "6px";
        iframe.style.marginTop = "10px";

        iframe.onload = function () {
            watchIframe(iframe);
        };

        inner.appendChild(iframe);
        body.appendChild(inner);

        well.appendChild(h3);
        well.appendChild(body);

        col.appendChild(well);
        section.appendChild(col);

        anchor.parentNode.insertBefore(section, anchor.nextSibling);
    }

    function init() {
        waitForJobLink().then(function (jobUrl) {
            if (!jobUrl) return;
            createTimeExpandedSection(jobUrl);
        });
    }

    init();

})();