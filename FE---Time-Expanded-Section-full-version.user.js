// ==UserScript==
// @name         FE - Time Expanded Section full version
// @namespace    http://tampermonkey.net/
// @version      1.3
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/FE---Time-Expanded-Section-full-version.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/FE---Time-Expanded-Section-full-version.user.js
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

    function createTimeExpandedSection(jobUrl) {

        var anchor = document.querySelector("#OrderRowsSection");
        if (!anchor) return;

        if (document.getElementById("timeExpandedSection")) return;

        // 🔥 OUTER WRAPPER (this is what makes it visually separate)
        var section = document.createElement("div");
        section.className = "row content-group";
        section.style.marginTop = "20px";   // <-- IMPORTANT separation

        var col = document.createElement("div");
        col.className = "col-md-12";

        var well = document.createElement("div");
        well.className = "well well-sm";

        // ---------------- HEADER ----------------
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

        // ---------------- BODY ----------------
        var body = document.createElement("div");
        body.className = "row collapse";
        body.id = id;

        var inner = document.createElement("div");
        inner.className = "col-md-12";

        var iframe = document.createElement("iframe");
        iframe.src = jobUrl;
        iframe.style.width = "100%";
        iframe.style.height = "2050px";
        iframe.style.border = "1px solid #ccc";
        iframe.style.borderRadius = "6px";
        iframe.style.marginTop = "10px";

        inner.appendChild(iframe);
        body.appendChild(inner);

        // assemble
        well.appendChild(h3);
        well.appendChild(body);

        col.appendChild(well);
        section.appendChild(col);

        // insert AFTER OrderRowsSection
        anchor.parentNode.insertBefore(section, anchor.nextSibling);
    }

    function init() {
        waitForJobLink().then(function (jobUrl) {
            if (!jobUrl) return;
            createTimeExpandedSection(jobUrl);
        });
    }

    window.addEventListener("load", init);

})();