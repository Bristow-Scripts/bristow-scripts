// ==UserScript==
// @name         LIB - Documents - Manual Review Report / Library Control Sheet / Grid Optimizer
// @namespace    https://bristow-scripts.github.io/bristow-scripts
// @version      1.8
// @description  Print Manual Review Report + Library Control Sheet + cached part-number search + edit-page helpers for Documentations
// @match        https://bristow-app.azurewebsites.net/Catalog/Documentations*
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/LIB---Documents-Manual-Review-Library-Control-Grid-Optimizer.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/LIB---Documents-Manual-Review-Library-Control-Grid-Optimizer.user.js
// @tag          LIB
// ==/UserScript==

(function () {
    'use strict';

    var BTN = 'padding:5px 14px;border:none;border-radius:5px;font-size:13px;font-family:system-ui,sans-serif;font-weight:600;cursor:pointer;';

    function grid() { return $('#grid').data('kendoGrid'); }

    function createButton(text, bg, color, onClick) {
        var btn = document.createElement('button');
        btn.textContent = text;
        btn.style.cssText = BTN + 'background:' + bg + ';color:' + color + ';';
        btn.addEventListener('click', onClick);
        return btn;
    }

    function normalizePart(s) {
        return String(s || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    }

    // The Location column is permanently filtered to exclude CAC rows.
    var LOCATION_EXCLUDE_CAC = { field: 'Location', operator: 'doesnotcontain', value: 'CAC' };

    function ensureLocationFilter(g) {
        try {
            var cur = g.dataSource.filter();
            var filters = (cur && cur.filters) ? cur.filters.filter(function (x) {
                return !(x && x.field === 'Location');
            }) : [];
            filters.push(LOCATION_EXCLUDE_CAC);
            g.dataSource.filter({ logic: 'and', filters: filters });
        } catch (e) {}
    }

    function initListPage() {
        if (window.__docManagerInited) return;
        window.__docManagerInited = true;
        injectUI();
        setupSearch();
        setupCache();
        setupGridEnhancements();
    }

    function setupSearch() {
        var label = document.querySelector('.search-group label');
        if (label && label.textContent.indexOf('Name') !== -1) label.textContent = 'Manual:';

        var input = document.getElementById('DocumentationSearch');
        if (!input) return;

        if (input.parentNode.querySelector('#DocumentationPartSearch')) return;

        var clone = input.cloneNode(true);
        clone.style.cssText = 'width:110px;display:inline-block;';
        input.parentNode.replaceChild(clone, input);

        var opts = document.createElement('span');
        opts.style.cssText = 'display:inline-flex;gap:8px;align-items:center;margin-left:6px;font-size:13px;';

        var startsWith = makeCheckbox('Exact');
        var toolSpec = makeCheckbox('Tool Spec');
        opts.appendChild(startsWith.wrap);
        opts.appendChild(toolSpec.wrap);
        clone.parentNode.appendChild(opts);

        var partInput = addPartNumberBox(clone);

        var timer = null;
        function applyFilter() {
            clearTimeout(timer);
            timer = setTimeout(function () {
                var g = grid();
                if (!g) return;
                var val = clone.value.trim();
                var filters = [];
                if (toolSpec.cb.checked) {
                    filters.push({ field: 'Name', operator: 'contains', value: 'Tool Spec' });
                    if (val) {
                        filters.push({ field: 'Name', operator: 'contains', value: val });
                    }
                } else if (val) {
                    filters.push({
                        field: 'Name',
                        operator: startsWith.cb.checked ? 'eq' : 'startswith',
                        value: val
                    });
                }
                filters.push({ field: 'Location', operator: 'doesnotcontain', value: 'CAC' });
                g.dataSource.filter({ logic: 'and', filters: filters });
            }, 150);
        }

        var pTimer = null;
        function applyPartFilter() {
            clearTimeout(pTimer);
            pTimer = setTimeout(function () {
                var g = grid();
                if (!g) return;
                var val = partInput.value.trim();
                if (!_allRecords) return;
                if (!val) {
                    applyRecords(g, _allRecords);
                    return;
                }
                var norm = normalizePart(val);
                var matched = [];
                for (var i = 0; i < _allRecords.length; i++) {
                    if (normalizePart(_allRecords[i].RelatedItems).indexOf(norm) !== -1) {
                        matched.push(_allRecords[i]);
                    }
                }
                applyRecords(g, matched);
            }, 150);
        }

        clone.addEventListener('keyup', applyFilter);
        startsWith.cb.addEventListener('change', applyFilter);
        toolSpec.cb.addEventListener('change', applyFilter);
        partInput.addEventListener('keyup', applyPartFilter);
    }

    function addPartNumberBox(manualInput) {
        var searchGroup = manualInput.closest('.search-group');
        if (!searchGroup) return null;

        var partGroup = document.createElement('div');
        partGroup.className = 'search-group';

        var lbl = document.createElement('label');
        lbl.htmlFor = 'DocumentationPartSearch';
        lbl.textContent = 'Part Number:';
        partGroup.appendChild(lbl);

        var partInput = document.createElement('input');
        partInput.id = 'DocumentationPartSearch';
        partInput.type = 'text';
        partInput.className = 'form-control';
        partInput.style.cssText = 'width:140px;display:inline-block;';
        partGroup.appendChild(partInput);

        searchGroup.parentNode.insertBefore(partGroup, searchGroup.nextSibling);
        return partInput;
    }

    function makeCheckbox(text) {
        var wrap = document.createElement('label');
        wrap.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-weight:normal;margin:0;cursor:pointer;';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.style.cssText = 'margin:0;width:auto;';
        wrap.appendChild(cb);
        wrap.appendChild(document.createTextNode(text));
        return { wrap: wrap, cb: cb };
    }

    function injectUI() {
        var well = document.querySelector('.well.well-sm');
        if (!well) return;

        if (document.querySelector('#btn-print-manual-review')) return;

        var row = document.createElement('div');
        row.style.cssText = 'margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;';

        var clearBtn = createButton('\u2715 Clear Filters', '#fff', '#c0392b', clearFilters);
        clearBtn.style.cssText += 'border:1px solid #c0392b;';
        clearBtn.id = 'btn-clear-filters';

        var printBtn = createButton('\uD83D\uDDA8 Print Manual Review Report', '#27ae60', '#fff', printManualReviewReport);
        printBtn.id = 'btn-print-manual-review';

        var refreshBtn = createButton('\u21BB Refresh Data', '#2980b9', '#fff', refreshCache);
        refreshBtn.id = 'btn-refresh-data';

        row.appendChild(clearBtn);
        row.appendChild(printBtn);
        row.appendChild(refreshBtn);
        well.appendChild(row);
    }

    function clearFilters() {
        var g = grid();
        if (!g) return;
        if (_allRecords) applyRecords(g, _allRecords);
        ensureLocationFilter(g);
        var search = document.getElementById('DocumentationSearch');
        if (search) search.value = '';
        var part = document.getElementById('DocumentationPartSearch');
        if (part) part.value = '';
        var boxes = document.querySelectorAll('#DocumentationSearch + span input[type="checkbox"]');
        boxes.forEach(function (b) { b.checked = false; });
    }

    // ==================== LOADING OVERLAY ====================

    function showLoading(show, text) {
        var el = document.getElementById('doc-loading');
        if (!el) {
            el = document.createElement('div');
            el.id = 'doc-loading';
            el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:99999;display:none;align-items:center;justify-content:center;';
            el.innerHTML = '<div style="background:#fff;padding:20px;border-radius:8px;font-family:system-ui;font-size:14px;text-align:center;">' +
                '<div id="doc-loading-text">Loading...</div>' +
                '<div id="doc-loading-count" style="margin-top:8px;font-weight:bold;"></div>' +
                '</div>';
            document.body.appendChild(el);
        }
        el.style.display = show ? 'flex' : 'none';
        var textEl = document.getElementById('doc-loading-text');
        if (textEl && text) textEl.textContent = text;
    }

    // ==================== FETCH EDIT PAGES ====================

    function decodeEntities(str) {
        var doc = new DOMParser().parseFromString(str, 'text/html');
        return doc.documentElement.textContent;
    }

    function parseEditPage(html) {
        function extract(name) {
            var m = html.match(new RegExp('id="Documentation_' + name + '"[^>]*value="([^"]*)"'));
            return m ? decodeEntities(m[1]) : '';
        }
        function extractTextarea(name) {
            var m = html.match(new RegExp('id="Documentation_' + name + '"[^>]*>([\\s\\S]*?)</textarea>'));
            return m ? decodeEntities(m[1]) : '';
        }
        return {
            Name: extract('Name'),
            Manufacturer: extract('Manufacturer'),
            RevisionInfo: extract('RevisionInfo'),
            ManualType: extract('ManualType'),
            ManualNumber: extract('ManualNumber'),
            Location: extract('Location'),
            Capability: extract('Capability'),
            ExpirationDate: extract('ExpirationDate'),
            ReviewDate: extract('ReviewDate'),
            Description: extractTextarea('Description')
        };
    }

    function fetchEditPage(id) {
        return fetch('/Catalog/Documentations/EditDocumentation?id=' + encodeURIComponent(id))
            .then(function (r) { return r.text(); })
            .then(function (html) { return parseEditPage(html); });
    }

    function fetchAllEditPages(items, onProgress) {
        var CONCURRENCY = 5;
        var results = [];
        var index = 0;
        var pending = 0;

        return new Promise(function (resolve) {
            if (items.length === 0) { resolve([]); return; }

            function doneOne(item) {
                results.push(item);
                pending--;
                if (onProgress) onProgress(results.length, items.length);
                launchNext();
                if (pending === 0 && index >= items.length) {
                    resolve(results);
                }
            }

            function launchNext() {
                while (pending < CONCURRENCY && index < items.length) {
                    var it = items[index++];
                    pending++;
                    (function (it) {
                        if (!it.Id) { doneOne(it); return; }
                        fetchEditPage(it.Id).then(function (rich) {
                            doneOne(Object.assign({}, it, rich));
                        }, function () {
                            doneOne(it);
                        });
                    })(it);
                }
            }

            launchNext();
        });
    }

    // ==================== PRINT MANUAL REVIEW REPORT ====================

    function parseDateOnly(s) {
        if (!s) return null;
        if (s instanceof Date) return isNaN(s.getTime()) ? null : s;
        var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        var d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }

    function printManualReviewReport() {
        refreshDataThen(doPrintManualReviewReport);
    }

    function doPrintManualReviewReport() {
        var g = grid();
        if (!g) return;
        var ds = g.dataSource;

        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var endDate = new Date(today);
        endDate.setDate(endDate.getDate() + 45);

        var all = ds.data();

        var items = [];
        for (var i = 0; i < all.length; i++) {
            var raw = all[i];
            var r = raw.toJSON ? raw.toJSON() : raw;
            if (r.DocStatus !== 4) continue;
            var cap = (r.Capability || '').toLowerCase();
            if (cap !== 'true' && cap !== 'yes') continue;
            var exp = parseDateOnly(r.ExpirationDate);
            if (!exp || exp < today || exp > endDate) continue;
            items.push(r);
        }

        items.sort(function (a, b) {
            var da = parseDateOnly(a.ExpirationDate);
            var db = parseDateOnly(b.ExpirationDate);
            return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
        });

        var printFilter = {
            logic: 'and',
            filters: [
                { field: 'DocStatus', operator: 'eq', value: 4 },
                {
                    logic: 'or',
                    filters: [
                        { field: 'Capability', operator: 'eq', value: 'true' },
                        { field: 'Capability', operator: 'eq', value: 'yes' }
                    ]
                },
                { field: 'ExpirationDate', operator: 'gte', value: today },
                { field: 'ExpirationDate', operator: 'lte', value: endDate },
                { field: 'Location', operator: 'doesnotcontain', value: 'CAC' }
            ]
        };
        ds.filter(printFilter);

        showLoading(true, 'Fetching document details...');

        fetchAllEditPages(items, function (done, total) {
            var countEl = document.getElementById('doc-loading-count');
            if (countEl) countEl.textContent = done + ' / ' + total;
        }).then(function (richItems) {
            richItems.sort(function (a, b) {
                var da = parseDateOnly(a.ExpirationDate);
                var db = parseDateOnly(b.ExpirationDate);
                return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
            });
            showLoading(false);
            generateManualReviewReportPrintout(richItems);
        });
    }

    function extractDetails(desc) {
        if (!desc) return '';
        var m = desc.match(/DETAILS:\s*([\s\S]*?)(?=\n\s*VERIFICATION HISTORY:|\n\s*REVISION INFO:|\s*$)/i);
        return m ? m[1].replace(/\s+/g, ' ').trim() : '';
    }

    function extractVerificationCycle(desc) {
        if (!desc) return '';
        var m = desc.match(/Verification Cycle:\s*([^\n]+)/i);
        return m ? m[1].replace(/\s+/g, ' ').trim() : '';
    }

    function generateManualReviewReportPrintout(data) {
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

        function formatDate(dateStr) {
            var d = parseDateOnly(dateStr);
            if (!d) return '';
            return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
        }

        var now = new Date();
        var dateStr = String(now.getDate()).padStart(2, '0') + '-' + months[now.getMonth()] + '-' + now.getFullYear();
        var timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        var totalPages = Math.ceil(data.length / 8) || 1;

        var h = '<html><head><title>Manual Review Report</title><style>';
        h += '@page { size: letter; margin: 10mm; }';
        h += 'body { font-family: Arial, sans-serif; font-size: 8pt; margin: 0; padding: 10mm; }';
        h += '.header { display: flex; justify-content: space-between; margin-bottom: 4px; }';
        h += '.header-left h1 { font-size: 14pt; margin: 0; font-weight: bold; }';
        h += '.header-left h2 { font-size: 12pt; margin: 2px 0 0 0; font-weight: bold; }';
        h += '.header-right { text-align: right; font-size: 8pt; }';
        h += '.header-right .date { font-size: 9pt; font-weight: bold; }';
        h += '.form-section { margin: 8px 0; font-size: 8pt; line-height: 1.6; }';
        h += '.form-line { border-bottom: 1px solid #000; display: inline-block; min-width: 200px; }';
        h += '.form-line-short { border-bottom: 1px solid #000; display: inline-block; min-width: 100px; }';
        h += '.item { border: 1px solid #000; margin-bottom: 8px; page-break-inside: avoid; }';
        h += '.item-content { display: flex; }';
        h += '.item-left { flex: 1; padding: 4px 8px; }';
        h += '.item-right { width: 200px; padding: 4px 8px; border-left: 1px solid #000; font-size: 7.5pt; }';
        h += '.item-row { display: flex; margin-bottom: 2px; padding-bottom: 2px; border-bottom: 1px solid #000; }';
        h += '.item-row:last-child { border-bottom: none; }';
        h += '.item-label { font-weight: bold; width: 110px; white-space: nowrap; }';
        h += '.item-value { flex: 1; }';
        h += '.item-location { font-weight: bold; font-size: 9pt; margin-top: 4px; }';
        h += '.right-row { display: flex; margin-bottom: 2px; padding-bottom: 2px; border-bottom: 1px solid #000; }';
        h += '.right-row:last-child { border-bottom: none; }';
        h += '.right-label { font-weight: bold; width: 110px; white-space: nowrap; flex-shrink: 0; }';
        h += '.right-value { flex: 1; font-weight: bold; }';
        h += '@media print { body { padding: 8mm; } }';
        h += '</style></head><body>';

        h += '<div class="header">';
        h += '<div class="header-left">';
        h += '<h1>Bristow Instruments</h1>';
        h += '<h2>Manual Review Report (45 Day Window)</h2>';
        h += '</div>';
        h += '<div class="header-right">';
        h += '<div class="date">' + dateStr + '</div>';
        h += '<div>' + timeStr + '</div>';
        h += '<div>Page 1 of ' + totalPages + '</div>';
        h += '</div>';
        h += '</div>';

        h += '<div class="form-section">';
        h += '<div>Manual Review form completed by: <span class="form-line"></span> Date: <span class="form-line-short"></span></div>';
        h += '<div>There were <span class="form-line-short"></span> changed control sheets inserted into the library. All removed control sheets are retained and attached to this Manual Review Report.</div>';
        h += '<div>Manual Review form reviewed by: <span class="form-line"></span> Date: <span class="form-line-short"></span></div>';
        h += '</div>';

        data.forEach(function (r) {
            var details = extractDetails(r.Description);
            var locCode = r.Location || '';
            var num = r.Name || r.ManualNumber || '';

            h += '<div class="item">';
            h += '<div class="item-content">';
            h += '<div class="item-left">';

            h += '<div class="item-row"><div class="item-label">MANUFACTURER:</div><div class="item-value">' + (r.Manufacturer || '') + '</div></div>';
            h += '<div class="item-row"><div class="item-label">REVISION INFO:</div><div class="item-value">' + (r.RevisionInfo || '') + '</div></div>';
            h += '<div class="item-row"><div class="item-label">MANUAL TYPE:</div><div class="item-value">' + (r.ManualType || '') + '</div></div>';
            h += '<div class="item-row"><div class="item-label">DETAILS:</div><div class="item-value">' + details + '</div></div>';

            h += '<div class="item-location">' + locCode + ' ' + num + '</div>';

            h += '</div>';
            h += '<div class="item-right">';

            h += '<div class="right-row"><span class="right-label">Expiration date:</span> <span class="right-value">' + formatDate(r.ExpirationDate) + '</span></div>';
            h += '<div class="right-row"><span class="right-label">Verification Cycle:</span> <span class="right-value">' + (extractVerificationCycle(r.Description) || '') + '</span></div>';
            h += '<div class="right-row"><span class="right-label">New Verification date:</span> <span class="right-value"></span></div>';
            h += '<div class="right-row"><span class="right-label">Manual Updated:</span> <span class="right-value"></span></div>';
            h += '<div class="right-row"><span class="right-label">New Control Sheet?:</span> <span class="right-value"></span></div>';

            h += '</div>';
            h += '</div>';
            h += '</div>';
        });

        h += '</body></html>';

        var w = window.open('', '_blank', 'width=1000,height=700');
        w.document.write(h);
        w.document.close();
        setTimeout(function () { w.print(); }, 500);
    }

    // ==================== PART NUMBER CACHE ====================

    var DB_NAME = 'BristowDocumentationCache';
    var DB_VERSION = 1;
    var STORE_NAME = 'docs';
    var CACHE_KEY = 'allDocs';
    var CACHE_SCHEMA = 4;
    var MAX_AGE_MS = 8 * 60 * 60 * 1000;

    var _status = null;
    var _cacheHandler = null;
    var _allRecords = null;
    var _suppressProtect = false;
    var SESSION_GUARD = 'bristow-wrelated-tried';

    function showStatus(msg, color) {
        if (!_status) {
            _status = document.createElement('div');
            _status.id = 'doc-cache-status';
            _status.style.cssText = 'position:fixed;bottom:70px;left:16px;z-index:99999;background:#333;color:#fff;font-size:12px;font-family:system-ui,sans-serif;padding:5px 10px;border-radius:6px;opacity:0.85;pointer-events:none;transition:opacity 0.4s;';
            document.body.appendChild(_status);
        }
        _status.style.background = color || '#333';
        _status.style.opacity = '0.85';
        _status.textContent = msg;
    }

    function hideStatus(delay) {
        setTimeout(function () {
            if (_status) _status.style.opacity = '0';
        }, delay || 2000);
    }

    function openDB(callback) {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
            e.target.result.createObjectStore(STORE_NAME);
        };
        req.onsuccess = function (e) { callback(null, e.target.result); };
        req.onerror = function (e) { callback(e.target.error, null); };
    }

    function dbGet(key, callback) {
        openDB(function (err, db) {
            if (err) return callback(err, null);
            var tx = db.transaction(STORE_NAME, 'readonly');
            var req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = function (e) { callback(null, e.target.result); };
            req.onerror = function (e) { callback(e.target.error, null); };
        });
    }

    function dbSet(key, value, callback) {
        openDB(function (err, db) {
            if (err) return callback && callback(err);
            var tx = db.transaction(STORE_NAME, 'readwrite');
            var req = tx.objectStore(STORE_NAME).put(value, key);
            req.onsuccess = function () { callback && callback(null); };
            req.onerror = function (e) { callback && callback(e.target.error); };
        });
    }

    function dbDelete(key, callback) {
        openDB(function (err, db) {
            if (err) return callback && callback(err);
            var tx = db.transaction(STORE_NAME, 'readwrite');
            var req = tx.objectStore(STORE_NAME).delete(key);
            req.onsuccess = function () { callback && callback(null); };
            req.onerror = function (e) { callback && callback(e.target.error); };
        });
    }

    function refreshCache() {
        var g = grid();
        if (!g) return;
        showStatus('\u23F3 Refreshing data (clearing cache)...', '#555');
        dbDelete(CACHE_KEY, function () {
            location.reload();
        });
    }

    // Re-fetches the full dataset from the server (bypassing the IndexedDB
    // cache), re-caches it, then continues.
    function refreshDataThen(done) {
        var g = grid();
        if (!g) { if (done) done(); return; }
        showLoading(true, 'Refreshing data...');
        var finished = false;
        function finish() {
            if (finished) return;
            finished = true;
            showLoading(false);
            if (done) done();
        }
        dbDelete(CACHE_KEY, function () {
            _allRecords = null;
            interceptAndCache(g);
            var onChange = function () {
                g.dataSource.unbind('change', onChange);
                setTimeout(finish, 400); // let the cache write land
            };
            g.dataSource.bind('change', onChange);
            setTimeout(finish, 30000); // safety net if the read never lands
            try {
                g.dataSource.read();
            } catch (e) {
                var wRel = document.getElementById('wRelated');
                if (wRel) {
                    wRel.checked = true;
                    try { window.$(wRel).trigger('change'); } catch (e2) {}
                }
            }
        });
    }

    function cleanRelatedItems(str) {
        if (!str) return '';
        var seen = {};
        var list = [];
        function add(p) {
            if (p && !seen[p]) {
                seen[p] = true;
                list.push(p);
            }
        }
        if (/\(/.test(str)) {
            var re = /\(([^)]*)\)/g;
            var m;
            while ((m = re.exec(str)) !== null) {
                var inner = m[1].replace(/\s+/g, ' ').trim();
                if (inner) {
                    var toks = inner.split(',');
                    for (var i = 0; i < toks.length; i++) add(toks[i].trim());
                }
            }
            return list.join(', ');
        }
        var plain = str.replace(/P-\d+\s*/g, '').split(',');
        for (var j = 0; j < plain.length; j++) add(plain[j].trim());
        return list.join(', ');
    }

    function onCacheData(grid) {
        var data = grid.dataSource.data();
        if (!data || data.length === 0) return;
        var plain = [];
        var hasRelated = false;
        for (var i = 0; i < data.length; i++) {
            var rec = data[i].toJSON ? data[i].toJSON() : data[i];
            plain.push(rec);
            if (rec.RelatedItems && String(rec.RelatedItems).trim() !== '') hasRelated = true;
        }
        if (!hasRelated) return;

        // Only trust a full dataset. A server-paged (or otherwise partial) view
        // would cache just a few rows, and then applyRecords/protectFromWipe
        // would pin the grid to only those rows on every later load.
        var total = 0;
        try { total = grid.dataSource.total() || 0; } catch (e) {}
        if (total > 0 && plain.length < total) return;

        // Never let a partial result shrink the working set. If this event only
        // carries a few rows, keep the larger dataset we already have.
        if (_allRecords && _allRecords.length > plain.length) return;

        plain.forEach(function (rec) {
            rec.RelatedItems = cleanRelatedItems(rec.RelatedItems);
        });
        _allRecords = plain;
        dbSet(CACHE_KEY, { timestamp: Date.now(), schema: CACHE_SCHEMA, records: plain }, function () {
            showStatus('\u2714 Part numbers loaded & cached', '#27ae60');
            hideStatus(2500);
        });
    }

    function interceptAndCache(grid) {
        if (_cacheHandler) {
            grid.dataSource.unbind('change', _cacheHandler);
        }
        _cacheHandler = function () { onCacheData(grid); };
        grid.dataSource.bind('change', _cacheHandler);
    }

    function applyRecords(grid, records) {
        try {
            // Intentional apply (including a zero-match filter result) - the
            // wipe protector must not treat this empty grid as data loss.
            _suppressProtect = true;
            grid.dataSource.transport.read = function (options) { options.success(records); };
            grid.dataSource.data(records);
        } catch (e) {}
        setTimeout(function () { _suppressProtect = false; }, 0);
    }

    function injectFromCache(grid, records) {
        _allRecords = records;
        applyRecords(grid, records);
    }

    function gridHasRelatedData(g) {
        try {
            var data = g.dataSource.data();
            if (!data || data.length === 0) return false;
            for (var i = 0; i < data.length && i < 100; i++) {
                var r = data[i].toJSON ? data[i].toJSON() : data[i];
                if (r.RelatedItems && String(r.RelatedItems).trim() !== '') return true;
            }
        } catch (e) {}
        return false;
    }

    function protectFromWipe(grid, records) {
        if (!records || !records.length) return;
        var handler = function () {
            if (_suppressProtect) return;
            if (gridHasRelatedData(grid)) return;
            try {
                var f = grid.dataSource.filter();
                grid.dataSource.transport.read = function (options) { options.success(records); };
                grid.dataSource.data(records);
                if (f) grid.dataSource.filter(f);
            } catch (e) {}
        };
        grid.dataSource.unbind('change', handler);
        grid.dataSource.bind('change', handler);
    }

    function setupCache() {
        var g = grid();
        if (!g) return;

        var wRel = document.getElementById('wRelated');
        if (wRel) wRel.checked = true;

        var sb = document.getElementById('searchBar');
        if (sb) sb.style.display = 'none';
        try { g.showColumn('RelatedItems'); } catch (e) {}

        dbGet(CACHE_KEY, function (err, cached) {
            var now = Date.now();
            var fresh = cached && cached.schema === CACHE_SCHEMA && cached.records &&
                cached.records.length > 0 && (now - cached.timestamp) <= MAX_AGE_MS;

            if (fresh) {
                showStatus('\u26A1 Part numbers from cache', '#27ae60');
                injectFromCache(g, cached.records);
                protectFromWipe(g, cached.records);
                hideStatus(1500);
                return;
            }

            if (gridHasRelatedData(g)) {
                showStatus('\u2714 Part numbers loaded & cached', '#27ae60');
                onCacheData(g);
                hideStatus(2500);
                return;
            }

            if (wRel) {
                showStatus('\u23F3 Loading part numbers (first time)...', '#555');
                interceptAndCache(g);
                protectFromWipe(g, cached && cached.records);
                wRel.checked = true;
                try {
                    g.dataSource.read();
                } catch (e) {
                    try {
                        window.$(wRel).trigger('change');
                    } catch (e2) {
                        wRel.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
                setTimeout(function () {
                    if (!gridHasRelatedData(g)) {
                        showStatus('\u26A0 No related items loaded \u2014 click Refresh Data', '#c0392b');
                    }
                }, 35000);
            }
        });
    }

    // ==================== GRID ENHANCEMENTS ====================

    function injectGridStyles() {
        if (document.getElementById('doc-grid-styles')) return;
        var st = document.createElement('style');
        st.id = 'doc-grid-styles';
        st.textContent =
            '#searchBar { display: none !important; }' +
            'label[for="wRelated"], #wRelated, #wRelated + small { display: none !important; }' +
            '.doc-clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }';
        document.head.appendChild(st);
    }

    function setupGridEnhancements() {
        var g = grid();
        if (!g) return;
        injectGridStyles();

        enforceColumnOrder(g);
        ensureLocationFilter(g);

        g.unbind('dataBound');
        g.bind('dataBound', function () { enhanceGridRows(g); });
    }

    function enforceColumnOrder(g) {
        try {
            var desired = ['RelatedItems', 'Location'];
            var targetIdx = 1;
            for (var d = 0; d < desired.length; d++) {
                var field = desired[d];
                var cur = -1;
                for (var i = 0; i < g.columns.length; i++) {
                    if (g.columns[i].field === field) { cur = i; break; }
                }
                if (cur !== -1 && cur !== targetIdx) {
                    g.reorderColumn(targetIdx, g.columns[cur]);
                }
                targetIdx++;
            }
        } catch (e) {}
    }

    function getColumnIndexByField(g, field) {
        var cols = g.columns;
        for (var i = 0; i < cols.length; i++) {
            if (cols[i].field === field) return i;
        }
        return -1;
    }

    function enhanceGridRows(g) {
        enforceColumnOrder(g);
        var descIdx = getColumnIndexByField(g, 'Description');
        var relIdx = getColumnIndexByField(g, 'RelatedItems');
        var partInput = document.getElementById('DocumentationPartSearch');
        var pVal = partInput ? partInput.value.trim() : '';

        try {
            var rows = g.tbody.find('tr');
            for (var i = 0; i < rows.length; i++) {
                var cells = rows[i].cells;
                if (descIdx >= 0 && cells[descIdx] && !cells[descIdx].querySelector('.doc-clamp')) {
                    var inner = document.createElement('div');
                    inner.className = 'doc-clamp';
                    inner.textContent = cells[descIdx].textContent;
                    cells[descIdx].textContent = '';
                    cells[descIdx].appendChild(inner);
                }
                if (relIdx >= 0 && pVal && cells[relIdx]) {
                    var cell = cells[relIdx];
                    var parts = (cell.textContent || '').split(',');
                    var seen = {};
                    var kept = [];
                    var normVal = normalizePart(pVal);
                    for (var j = 0; j < parts.length; j++) {
                        var p = parts[j].trim();
                        if (p && !seen[p] && normalizePart(p).indexOf(normVal) !== -1) {
                            seen[p] = true;
                            kept.push(p);
                        }
                    }
                    cell.textContent = kept.join(', ');
                }
            }
        } catch (e) {}
    }

    // ==================== EDIT PAGE ====================

    function setupEditPage() {
        var input = document.getElementById('Documentation_Capability');
        if (!input || input.tagName === 'SELECT') return;

        var select = document.createElement('select');
        select.className = input.className;
        select.id = input.id;
        select.name = input.name;

        var current = (input.value || '').trim().toUpperCase();
        ['TRUE', 'FALSE'].forEach(function (opt) {
            var o = document.createElement('option');
            o.value = opt;
            o.textContent = opt;
            if (opt === current) o.selected = true;
            select.appendChild(o);
        });

        input.parentNode.replaceChild(select, input);
    }

    // ==================== INIT ====================

    function tryInit() {
        if (window.$ && grid()) {
            initListPage();
            return true;
        }
        return false;
    }

    function startInit() {
        var t = 0;
        var id = setInterval(function () {
            t++;
            if (tryInit() || t > 40) clearInterval(id);
        }, 250);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startInit);
    } else {
        startInit();
    }

    setTimeout(function () {
        setupEditPage();
    }, 300);
})();

// ==================== LIBRARY CONTROL SHEET ====================

(function () {
    'use strict';

    var FIELD = {
        id:            'Documentation_Id',
        name:          'Documentation_Name',
        expDate:       'Documentation_ExpirationDate',
        reviewDate:    'Documentation_ReviewDate',
        description:   'Documentation_Description',
        docStatus:     'Documentation_DocStatus',
        manualNumber:  'Documentation_ManualNumber',
        manualType:    'Documentation_ManualType',
        manufacturer:  'Documentation_Manufacturer',
        location:      'Documentation_Location',
        capability:    'Documentation_Capability',
        qcWorkLevel:   'Documentation_QcWorkLevel',
        infoSource:    'Documentation_InformationSource',
        section:       'Documentation_Section',
        revisionInfo:  'Documentation_RevisionInfo'
    };

    function val(id) {
        var el = document.getElementById(id);
        return el ? (el.value || '').trim() : '';
    }

    function selectedText(id) {
        var el = document.getElementById(id);
        if (!el || el.tagName !== 'SELECT') return '';
        var opt = el.options[el.selectedIndex];
        return opt ? opt.textContent.trim() : '';
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function formatDMY(isoDate) {
        if (!isoDate) return '';
        var m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return isoDate;
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var day = parseInt(m[3], 10);
        var mon = months[parseInt(m[2], 10) - 1] || m[2];
        return day + '-' + mon + '-' + m[1];
    }

    function capabilityToYesNo(raw) {
        var v = (raw || '').trim().toUpperCase();
        if (v === 'TRUE' || v === 'YES' || v === 'Y') return 'Yes';
        if (v === 'FALSE' || v === 'NO' || v === 'N') return 'No';
        return raw || '';
    }

    function parseDescription(text) {
        var result = { verificationCycle: '', generalInfo: '', verificationHistory: '' };
        if (!text) return result;

        var vcMatch = String(text).match(/Verification Cycle:\s*(\d+)/i);
        if (vcMatch) result.verificationCycle = vcMatch[1];

        var detailsIdx = String(text).search(/DETAILS:/i);
        var vhIdx = String(text).search(/VERIFICATION HISTORY:/i);

        if (detailsIdx !== -1) {
            var end = vhIdx !== -1 ? vhIdx : String(text).length;
            result.generalInfo = String(text).slice(detailsIdx + 'DETAILS:'.length, end).trim();
        }
        if (vhIdx !== -1) {
            result.verificationHistory = String(text).slice(vhIdx + 'VERIFICATION HISTORY:'.length).trim();
        }
        return result;
    }

    function getTagValue(tags, tagTypeName) {
        if (!tags || !tags.length) return '';
        for (var i = 0; i < tags.length; i++) {
            if (tags[i].TagTypeName === tagTypeName) return (tags[i].TagValue || '');
        }
        return '';
    }

    function cleanItemDescription(desc, partNumber, manufacturer) {
        var d = desc || '';
        if (partNumber) d = d.split(partNumber).join('');
        if (manufacturer) d = d.split(manufacturer).join('');
        return d.replace(/\s+/g, ' ').trim();
    }

    function fetchItems(documentationId) {
        var url = './EditDocumentation?documentationId=' + encodeURIComponent(documentationId) + '&handler=Items';
        return fetch(url, { credentials: 'same-origin' })
            .then(function (resp) {
                if (!resp.ok) return [];
                return resp.json();
            })
            .then(function (data) {
                if (Array.isArray(data)) return data;
                if (Array.isArray(data && data.Data)) return data.Data;
                if (Array.isArray(data && data.data)) return data.data;
                return [];
            })
            .catch(function () { return []; });
    }

    function buildPrintHTML(fields, parsedDesc, itemRows) {
        var capYesNo = capabilityToYesNo(fields.capability);

        var rowsHtml = '';
        if (itemRows.length) {
            itemRows.forEach(function (r) {
                rowsHtml += '<tr>' +
                    '<td>' + escapeHtml(fields.manualNumber) + '</td>' +
                    '<td>' + escapeHtml(r.partNumber) + '</td>' +
                    '<td>' + escapeHtml(r.description) + '</td>' +
                    '<td>' + escapeHtml(capYesNo) + '</td>' +
                    '</tr>';
            });
        } else {
            rowsHtml = '<tr><td colspan="4" class="lcs-empty">No items found</td></tr>';
        }

        return '' +
        '<h1>LIBRARY CONTROL SHEET</h1>' +
        '<table class="lcs-box">' +
        '<tr>' +
        '<td class="lcs-label">MANUAL NUMBER</td>' +
        '<td class="lcs-big">' + escapeHtml(fields.manualNumber) + '</td>' +
        '<th colspan="2">MATERIAL STATUS</th>' +
        '<th colspan="2">' + escapeHtml(fields.docStatus || 'STATUS') + '</th>' +
        '</tr>' +
        '<tr>' +
        '<td class="lcs-label">LOCATION</td>' +
        '<td class="lcs-big">' + escapeHtml(fields.location) + '</td>' +
        '<td class="lcs-label" colspan="2">Verification Due:</td>' +
        '<td colspan="2">' + escapeHtml(formatDMY(fields.expDate)) + '</td>' +
        '</tr>' +
        '<tr>' +
        '<td class="lcs-label">CAP</td>' +
        '<td>' + escapeHtml(capYesNo) + '</td>' +
        '<td class="lcs-label" colspan="2">Verification Cycle: (Months)</td>' +
        '<td colspan="2">' + escapeHtml(parsedDesc.verificationCycle) + '</td>' +
        '</tr>' +
        '<tr>' +
        '<td class="lcs-label">QC Work Level</td>' +
        '<td>' + escapeHtml(fields.qcWorkLevel) + '</td>' +
        '<td class="lcs-label">Section</td>' +
        '<td colspan="3">' + escapeHtml(fields.section) + '</td>' +
        '</tr>' +
        '<tr>' +
        '<td class="lcs-label">MANUFACTURER</td>' +
        '<td colspan="5">' + escapeHtml(fields.manufacturer) + '</td>' +
        '</tr>' +
        '<tr>' +
        '<td class="lcs-label">MANUAL TYPE</td>' +
        '<td colspan="5">' + escapeHtml(fields.manualType) + '</td>' +
        '</tr>' +
        '<tr>' +
        '<td class="lcs-label">REVISION INFO</td>' +
        '<td colspan="5">' + escapeHtml(fields.revisionInfo) + '</td>' +
        '</tr>' +
        '</table>' +
        '<table class="lcs-box">' +
        '<tr><th>General Information Source</th></tr>' +
        '<tr><td class="lcs-freetext">' + (escapeHtml(parsedDesc.generalInfo) || '&nbsp;') + '</td></tr>' +
        '</table>' +
        '<table class="lcs-box">' +
        '<tr><th>Verification History</th></tr>' +
        '<tr><td class="lcs-history-cell"><div class="lcs-history">' + (escapeHtml(parsedDesc.verificationHistory) || '&nbsp;') + '</div></td></tr>' +
        '</table>' +
        '<table class="lcs-items">' +
        '<thead><tr><th>MAN. #</th><th>PART NUMBER</th><th>DESCRIPTION</th><th>CAP</th></tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
        '</table>';
    }

    function printLibraryControlSheet() {
        var documentationId = val(FIELD.id);
        var fields = {
            manualNumber: val(FIELD.manualNumber),
            manualType:   val(FIELD.manualType),
            manufacturer: val(FIELD.manufacturer),
            location:     val(FIELD.location),
            capability:   val(FIELD.capability),
            qcWorkLevel:  val(FIELD.qcWorkLevel),
            infoSource:   val(FIELD.infoSource),
            section:      val(FIELD.section),
            revisionInfo: val(FIELD.revisionInfo),
            expDate:      val(FIELD.expDate),
            docStatus:    selectedText(FIELD.docStatus)
        };
        var parsedDesc = parseDescription(val(FIELD.description));

        fetchItems(documentationId).then(function (rawItems) {
            var itemRows = (rawItems || []).map(function (item) {
                var partNumber = getTagValue(item.Tags, 'Part Number');
                return {
                    partNumber: partNumber,
                    description: cleanItemDescription(item.Description, partNumber, fields.manufacturer)
                };
            });

            var win = window.open('', '_blank', 'width=900,height=1000');
            if (!win) { alert('Pop-up blocked - please allow pop-ups for this site to print.'); return; }

            var css = '' +
            'body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 24px; font-size: 12px; }' +
            'h1 { font-size: 20px; margin: 0 0 12px; }' +
            'table.lcs-box, table.lcs-items { border-collapse: collapse; width: 100%; margin-bottom: 10px; }' +
            'table.lcs-box td, table.lcs-box th, table.lcs-items td, table.lcs-items th { border: 1px solid #333; padding: 4px 6px; text-align: left; vertical-align: top; }' +
            'table.lcs-box th { background: #e6e6e6; font-size: 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
            '.lcs-label { font-weight: 600; width: 160px; background: #f5f5f5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
            '.lcs-big { font-size: 16px; font-weight: 700; }' +
            '.lcs-blank { min-width: 60px; }' +
            '.lcs-freetext { white-space: pre-wrap; min-height: 40px; }' +
            '.lcs-history-cell { padding: 0; }' +
            '.lcs-history { font-size: 10px; line-height: 12px; height: 48px; overflow: hidden; white-space: pre-wrap; padding: 4px 6px; }' +
            'table.lcs-items th { background: #265c89; color: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
            'table.lcs-items td.lcs-empty { text-align: center; color: #999; font-style: italic; }' +
            '.lcs-cb { display: inline-block; }' +
            '.lcs-box-cb { display: inline-block; width: 11px; height: 11px; border: 1px solid #333; margin-right: 4px; vertical-align: middle; }' +
            '@media print { body { margin: 0.4in; } }';

            win.document.write('<!DOCTYPE html><html><head><title>Library Control Sheet - ' + escapeHtml(fields.manualNumber) + '</title><meta charset="utf-8"><style>' + css + '</style></head><body>' + buildPrintHTML(fields, parsedDesc, itemRows) + '</body></html>');
            win.document.close();
            win.onload = function () { win.focus(); win.print(); };
        });
    }

    function addPrintButton() {
        if (document.getElementById('lcs-print-btn')) return true;
        var heading = null;
        var hs = document.querySelectorAll('h2');
        for (var i = 0; i < hs.length; i++) {
            if (hs[i].textContent.trim() === 'Edit Documentation') { heading = hs[i]; break; }
        }
        if (!heading) return false;

        var btn = document.createElement('button');
        btn.id = 'lcs-print-btn';
        btn.type = 'button';
        btn.className = 'btn btn-default';
        btn.style.cssText = 'margin-left:12px;';
        btn.textContent = '\uD83D\uDDA8 Print Library Control Sheet';
        btn.addEventListener('click', function () {
            btn.disabled = true;
            printLibraryControlSheet().then(function () { btn.disabled = false; }, function () { btn.disabled = false; });
        });

        heading.appendChild(btn);
        return true;
    }

    var observer = new MutationObserver(function () { addPrintButton(); });
    observer.observe(document.body, { childList: true, subtree: true });
    addPrintButton();
})();
