// ==UserScript==
// @name         TECH - Time Expanded Section Trimmed
// @namespace    http://tampermonkey.net/
// @version      4.0
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Time-Expanded-Section-Trimmed.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Time-Expanded-Section-Trimmed.user.js
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';
    var BR_MAX_IFRAME_HEIGHT = 5000;

    function hideExtraIframeUI(doc) {
        if (doc.documentElement.dataset.brUiHidden === "1") return;
        doc.documentElement.dataset.brUiHidden = "1";

        // Hide filter label-card groups by label text
        doc.querySelectorAll(".form-group.label-card").forEach(function (group) {
            var label = group.querySelector(".control-label");
            if (!label) return;
            var text = label.textContent.trim();
            if (["Sub Category", "Activity", "Task", "Checklist"].indexOf(text) !== -1) {
                group.style.display = "none";
            }
        });

        // Hide the standalone filter controls (category select, etc.)
        var filterIds = ['ServiceCategorySearch', 'ServiceNumberSearch', 'ServiceAltServiceNumberSearch'];
        filterIds.forEach(function (id) {
            var el = doc.getElementById(id);
            if (!el) return;
            var parent = el.closest('.col-md-2, .col-md-3, .col-md-4, .form-group');
            if (parent) { parent.style.display = 'none'; } else { el.style.display = 'none'; }
        });

        doc.querySelectorAll('a[href*="ServiceTimeTracking"]').forEach(function (el) {
            el.style.display = "none";
        });

        doc.querySelectorAll("tr").forEach(function (tr) {
            var th = tr.querySelector("th");
            if (!th) return;
            var label = th.textContent.trim();
            if (label === "Output" || label === "Job Status") {
                tr.style.display = "none";
            }
        });

        doc.querySelectorAll("label").forEach(function (lbl) {
            if (lbl.textContent.trim() === "Service Tags") {
                lbl.style.display = "none";
            }
        });
    }

    function hideOrderLineColumns(doc) {
        // ── Hide Cost, Markup, Price, Per, Subtotal columns ──
        // Headers
        doc.querySelectorAll('tr.lq-table-header-w-options th').forEach(function (th) {
            var label = th.textContent.trim();
            if (['Cost', 'Markup', 'Price', 'Per', 'Subtotal'].indexOf(label) !== -1) {
                th.style.display = 'none';
            }
        });
        // Line item data cells
        ['OrderLineCostMask_', 'OrderLineMarkup_', 'OrderLinePriceMask_', 'OrderLinePricedPerDefault_', 'OrderLineSubtotal_'].forEach(function (prefix) {
            doc.querySelectorAll('tr.line-item > td:has(input[id^="' + prefix + '"])').forEach(function (td) {
                td.style.display = 'none';
            });
        });
        // Source line data cells
        ['OrderLineSourceCost_', 'OrderLineSourceMarkup_', 'OrderLineSourcePrice_', 'OrderLineSourceSubtotal_'].forEach(function (prefix) {
            doc.querySelectorAll('tr.sourceLine > td:has(input[id^="' + prefix + '"])').forEach(function (td) {
                td.style.display = 'none';
            });
        });
        // Source line "Per Unit" column (no input — nth-child 8)
        doc.querySelectorAll('tr.sourceLine > td:nth-child(8)').forEach(function (td) {
            td.style.display = 'none';
        });
    }

    function removeInternalScrollContainers(doc) {
        if (doc.documentElement.dataset.brScrollFixed === "1") return;
        doc.documentElement.dataset.brScrollFixed = "1";

        doc.querySelectorAll('*').forEach(function (el) {
            if (el.closest('.k-animation-container, .k-list-container, .k-popup, .k-grid-header')) return;
            var cs = doc.defaultView.getComputedStyle(el);
            var isScrollable = (cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'overlay');
            var isHeightConstrained =
                (cs.maxHeight && cs.maxHeight !== 'none') ||
                (cs.height && cs.height !== 'auto');

            if (isScrollable && (cs.overflowY !== 'auto' || isHeightConstrained)) {
                el.style.overflowY = 'visible';
                el.style.maxHeight = 'none';
            }
        });
    }

    function pollResizeUntilStable(iframe) {
        if (iframe.dataset.brPollDone === "1") return;
        if (iframe.dataset.brPolling === "1") return;
        iframe.dataset.brPolling = "1";

        var stableCount = 0;
        var lastHeight = -1;
        var attempts = 0;
        var maxAttempts = 30;

        var poll = setInterval(function () {
            attempts++;
            try {
                var doc = iframe.contentDocument || iframe.contentWindow.document;
                if (!doc || !doc.body) return;
                var h = Math.min(Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, 300), BR_MAX_IFRAME_HEIGHT);
                if (h !== lastHeight) {
                    iframe.style.height = (h + 20) + "px";
                    lastHeight = h;
                    stableCount = 0;
                } else {
                    stableCount++;
                }
                if (stableCount >= 3 || attempts >= maxAttempts) {
                    clearInterval(poll);
                    iframe.dataset.brPolling = "0";
                    iframe.dataset.brPollDone = "1";
                }
            } catch (e) {
                clearInterval(poll);
                iframe.dataset.brPolling = "0";
                iframe.dataset.brPollDone = "1";
            }
        }, 200);
    }

    function observeIframeHeight(iframe) {
        if (iframe.dataset.brResizeObserverAttached === "1") return;
        try {
            var doc = iframe.contentDocument || iframe.contentWindow.document;
            if (!doc || !doc.documentElement) return;

            var applyingSelf = false;
            var stableCount = 0;
            var lastApplied = -1;

            var ro = new ResizeObserver(function () {
                if (applyingSelf) return;

                var h = Math.min(Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, 300), BR_MAX_IFRAME_HEIGHT);
                var target = h + 20;

                if (Math.abs(target - lastApplied) < 10) {
                    stableCount++;
                    if (stableCount >= 3) {
                        if (h >= BR_MAX_IFRAME_HEIGHT) {
                            console.warn("[Trim] Iframe hit max height cap - content may be taller than expected");
                        }
                        ro.disconnect();
                    }
                    return;
                }

                stableCount = 0;
                lastApplied = target;
                applyingSelf = true;
                iframe.style.height = target + "px";
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () { applyingSelf = false; });
                });
            });

            ro.observe(doc.documentElement);
            iframe.dataset.brResizeObserverAttached = "1";
        } catch (e) {
            console.warn("[Trim] Could not attach ResizeObserver", e);
        }
    }

    function neutralizeIframeBackground(doc) {
        if (doc.getElementById("br-trim-style-overrides")) return;
        var style = doc.createElement("style");
        style.id = "br-trim-style-overrides";
        style.textContent = "html, body { background: #fff !important; }";
        doc.head.appendChild(style);
    }

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

    function refreshServiceGrid(doc, win) {
        try {
            var gridEl = doc.getElementById('serviceGrid');
            if (!gridEl) return;
            var $ = win.jQuery;
            // Try Kendo Grid
            var grid = $(gridEl).data('kendoGrid');
            if (grid && grid.dataSource) {
                grid.dataSource.read();
                return;
            }
            // Fallback: try refreshLines
            if (typeof win.refreshLines === 'function') {
                win.refreshLines();
            }
        } catch (e) {
            console.warn("[Trim] Could not refresh grid", e);
        }
    }

    function preloadServiceFilters(iframe, doc) {
        if (iframe.dataset.brFiltersPreloaded === "1") return;

        try {
            var win = iframe.contentWindow;
            var $ = win.jQuery;

            // Find ALL tag combos, fetch each, and use the one containing "Hourly"
            var tagInputs = doc.querySelectorAll('input[data-role="combobox"][id^="TagSearch_"]');
            var categorySelect = doc.getElementById("ServiceCategorySearch");

            if (!categorySelect) {
                var retries = parseInt(iframe.dataset.brFilterRetries || "0");
                if (retries < 3) {
                    iframe.dataset.brFilterRetries = String(retries + 1);
                    setTimeout(function () {
                        preloadServiceFilters(iframe, doc);
                    }, 1500);
                }
                return;
            }

            iframe.dataset.brFiltersPreloaded = "1";

            // Category select: native DOM change event (run this regardless of combo)
            try {
                var otherOption = Array.from(categorySelect.options).find(function (o) {
                    return o.text.trim() === "OTHER";
                });
                if (otherOption) {
                    categorySelect.value = otherOption.value;
                    if (typeof win.serviceCategorySearch === 'function') {
                        win.serviceCategorySearch();
                    }
                    categorySelect.dispatchEvent(new Event('change'));
                }
            } catch (e) {
                console.warn("[Trim] Could not set category filter", e);
            }

            // Discover the Task tag combo by probing all combos for "Hourly"
            var combos = [];
            if ($ && tagInputs) {
                Array.from(tagInputs).forEach(function (input) {
                    var c = $(input).data("kendoComboBox");
                    if (c) {
                        var url = c.dataSource && c.dataSource.transport && c.dataSource.transport.options && c.dataSource.transport.options.read && c.dataSource.transport.options.read.url;
                        combos.push({ combo: c, url: url || '?' });
                    }
                });
            }
            console.log('[Trim] Found ' + combos.length + ' combo(s)');

            // Probe each combo's data to find "Hourly"
            var combo = null;
            var match = null;
            var probeIdx = 0;

            function probeNext() {
                if (probeIdx >= combos.length) {
                    console.warn('[Trim] No combo contains "Hourly"');
                    return;
                }
                var entry = combos[probeIdx];
                var sep = entry.url.indexOf('?') > -1 ? '&' : '?';
                console.log('[Trim] Probing #' + probeIdx + ': ' + entry.url);
                $.ajax({
                    url: entry.url + sep + 'take=9999',
                    dataType: "json",
                    success: function (data) {
                        var items = data;
                        if (data && data.Data) items = data.Data;
                        if (Array.isArray(items)) {
                            var m = items.find(function (item) {
                                return item.Text && item.Text.toLowerCase().indexOf("hourly") !== -1;
                            });
                            if (m) {
                                combo = entry.combo;
                                match = m;
                                console.log('[Trim] Found "Hourly" in combo #' + probeIdx + ': ' + match.Text + ' = ' + match.Value);
                                setupComboAndGrid();
                                return;
                            }
                        }
                        probeIdx++;
                        probeNext();
                    },
                    error: function () {
                        probeIdx++;
                        probeNext();
                    }
                });
            }

            function setupComboAndGrid() {
                // 1. Display the text in the input box
                var rawInput = combo.input ? (combo.input[0] || combo.input) : null;
                if (rawInput) {
                    rawInput.value = match.Text;
                }
                // 2. Set Kendo internal state so combo.value() returns the UUID
                combo._value = match.Value;
                combo._selectedValue = match.Value;
                combo._selectedText = match.Text;
                // 3. Override combo.value() getter (ensures any internal code reads the UUID)
                var _origVal = combo.value.bind(combo);
                combo.value = function (val) {
                    return val !== undefined ? _origVal(val) : match.Value;
                };
                // 4. Set combobox value via Kendo's public API (may fail in virtual mode, but best-effort)
                try { combo.value(match.Value); } catch (e) { /* virtual mode - ignore */ }
                // 5. Disable server operations (use internal Kendo properties)
                var grid = doc.getElementById('serviceGrid') && $(doc.getElementById('serviceGrid')).data('kendoGrid');
                if (grid && grid.dataSource) {
                    var ds = grid.dataSource;
                    ds._serverPaging = false;
                    ds._serverSorting = false;
                    ds._serverFiltering = false;
                    // Hook schema.parse to filter every response by Task
                    if (ds.options && ds.options.schema) {
                        var schema = ds.options.schema;
                        var origParse = schema.parse;
                        schema.parse = function (response) {
                            if (response && Array.isArray(response.Data)) {
                                response.Data = response.Data.filter(function (svc) {
                                    return svc.ServiceTags && svc.ServiceTags.some(function (tag) {
                                        return tag.TagTypeName === "Task" && tag.TagValue && tag.TagValue.trim().toLowerCase() === "hourly";
                                    });
                                });
                                response.Total = response.Data.length;
                            }
                            return origParse ? origParse(response) : response;
                        };
                    }
                }
                // 6. Trigger the page's own serviceTagSearch handler (which reads combo.value())
                if (typeof win.serviceTagSearch === 'function') {
                    win.serviceTagSearch();
                }
                // 7. Watchdog
                var ticks = 0;
                var watchdog = setInterval(function () {
                    if (rawInput && rawInput.value !== match.Text) {
                        rawInput.value = match.Text;
                    }
                    if (++ticks > 30) clearInterval(watchdog);
                }, 100);
                console.log('[Trim] Set combo value to:', combo.value ? combo.value() : '?');
                combo.close();
                refreshServiceGrid(doc, win);
            }

            probeNext();
        } catch (e) {
            console.warn("[Trim] Could not preload service filters", e);
            iframe.dataset.brFiltersPreloaded = "0";
        }
    }

    function removeStuffFromIframe(iframe) {
        try {
            var doc = iframe.contentDocument || iframe.contentWindow.document;
            if (!doc) return;

            if (!doc.querySelector('#serviceGrid')) {
                console.log('[Trim] Grid not ready yet - skipping');
                return;
            }

            console.log('[Trim] Grid ready - performing cleanup');
            neutralizeIframeBackground(doc);
            // removeInternalScrollContainers(doc);  // can cause whitespace (removes overflow constraints)
            preloadServiceFilters(iframe, doc);
            hideExtraIframeUI(doc);

            doc.querySelectorAll('a.btn.btn-default[href="#HeaderTarget"]').forEach(el => el.remove());
            doc.querySelectorAll('a.btn.btn-default[href="#AddPartTarget"]').forEach(el => el.remove());
            doc.querySelectorAll('a.btn.btn-default[href="#CommentsTarget"]').forEach(el => el.remove());

            var navbar = doc.querySelector("nav.navbar");
            if (navbar) navbar.remove();

            var jumpLinks = doc.querySelectorAll(
                'a[href="#HeaderTarget"], a[href="#AddPartTarget"], a[href="#RQsTarget"], a[href="#CommentsTarget"]'
            );

            jumpLinks.forEach(function (link) {
                var container = link.closest(".col-md-4");
                if (container) container.remove();
            });

            var commentsTarget = doc.getElementById("CommentsTarget");
            if (commentsTarget) {
                var section = commentsTarget.closest(".row.content-group");
                if (section) section.remove();
            }

            var desc = doc.getElementById("HeaderInfo_Description");
            var notes = doc.getElementById("HeaderInfo_JobNotes");

            [desc, notes].forEach(function (el) {
                if (el) {
                    var row = el.closest(".row");
                    if (row) row.remove();
                }
            });

            var partsTabLink = doc.querySelector('a[href="#partPicker"]');
            if (partsTabLink) {
                var li = partsTabLink.closest("li");
                if (li) li.remove();
            }

            var partsContent = doc.getElementById("partPicker");
            if (partsContent) partsContent.remove();

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

            doc.querySelectorAll("h5").forEach(function (h) {
                if (h.textContent.trim() === "Order Line Details") {
                    var row = h.closest(".row");
                    if (row) row.remove();
                }
            });

            doc.querySelectorAll('input[type="submit"][value="Save"]').forEach(btn => btn.remove());

            var readyBtn = doc.getElementById("readyButton");
            if (readyBtn) readyBtn.remove();

            var completeBtn = doc.getElementById("completeButton");
            if (completeBtn) completeBtn.remove();

            doc.querySelectorAll('a[href*="/Orders/Jobs/PerformServices"]').forEach(function (el) {
                el.remove();
            });

            doc.querySelectorAll('a[href*="ReportGenerator/PrintPDF"]').forEach(btn => btn.remove());

            var footer = doc.querySelector("footer");
            if (footer) footer.remove();

            doc.querySelectorAll("a.accordion-toggle").forEach(function (toggle) {
                if (toggle.textContent.trim() === "Uploads") {
                    var well = toggle.closest(".well.well-sm");
                    if (well) well.remove();
                }
            });

            var orderSubtotal = doc.getElementById("OrderSubtotal");
            if (orderSubtotal) {
                var container = orderSubtotal.closest(".container-fluid");
                if (container) container.remove();
            }

            var refreshBtn = doc.querySelector('button[onclick="refreshLines()"]');
            var saveBtn = doc.querySelector('button[onclick="saveAll()"]');

            if (refreshBtn && saveBtn) {

                var container = refreshBtn.parentElement;

                while (container && !container.contains(saveBtn)) {
                    container = container.parentElement;
                }

                if (container) {
                    container.style.width = "100%";
                    container.style.display = "flex";
                    container.style.justifyContent = "flex-end";
                    container.style.alignItems = "center";
                    container.style.gap = "5px";
                    container.style.paddingRight = "0px";
                    container.style.marginRight = "0px";

                    saveBtn.style.order = "1";
                    refreshBtn.style.order = "2";
                }
            }

            hideOrderLineColumns(doc);

            pollResizeUntilStable(iframe);
            observeIframeHeight(iframe);

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
        iframe.style.height = "2000px";
        iframe.style.border = "1px solid #ccc";
        iframe.style.borderRadius = "6px";
        iframe.style.marginTop = "10px";
        iframe.style.overflow = "hidden";

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
