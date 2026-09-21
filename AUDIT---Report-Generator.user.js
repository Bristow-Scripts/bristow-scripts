// ==UserScript==
// @name         AUDIT - Compliance Report Generator
// @namespace    https://bristow-scripts.github.io/bristow-scripts
// @version      4.38
// @description  Multi-page audit console: Work Orders, POs, Library, Tools, Inventory. Date range, category filters, PDF export.
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/AUDIT---Report-Generator.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/AUDIT---Report-Generator.user.js
// @match        https://liquid-264-drc0bgd0eje0ckcg.westus3-01.azurewebsites.net/*
// @exclude      https://liquid-264-drc0bgd0eje0ckcg.westus3-01.azurewebsites.net/ReportDesigner*
// @noframes
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @require      https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Shared-Core.user.js
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @tag          AUDIT
// ==/UserScript==

(function () {
    'use strict';

    // ═════════════════════════════════════════════════════════════════════════
    //  CONSTANTS
    // ═════════════════════════════════════════════════════════════════════════

    var TS = window.TechShared || null;
    var $p = window.unsafeWindow.jQuery || window.unsafeWindow.$ || null;
    var SCRIPT_ID = 'audit-console';
    var BUTTON_ID = SCRIPT_ID + '-btn';
    var MODAL_ID = SCRIPT_ID + '-modal';
    var EXCLUDED_CATEGORIES = (function () {
        var s = {};
        ['COR', 'Direct Sale (Parts & Components)', 'Tool', 'SHOP SUPPLIES', 'SHP', 'QUA', 'PTR', 'PSS', 'CAC']
            .forEach(function (c) { s[String(c).trim().toUpperCase()] = true; });
        return s;
    })();
    var STYLE_ID = SCRIPT_ID + '-style';
    var TOAST_ID = SCRIPT_ID + '-toast';
    var STORAGE_KEY = SCRIPT_ID + '-dispatch';
    var pendingFilters = null;
    var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var MONTHS_MAP = {JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};

    var CC_CACHE_KEY = SCRIPT_ID + '-cc-cache';
    var CC_CACHE_AGE_KEY = SCRIPT_ID + '-cc-cache-age';
    var CC_CACHE_PROGRESS_KEY = SCRIPT_ID + '-cc-progress';
    var CC_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
    var CC_CHUNK_SIZE = 10;  // small chunks = progress text updates every ~10 orders instead of every 50
    var CC_PARALLEL = 8;
    // Is Warranty flag per order (from the Edit page's disabled checkbox), cached
    // so the Warranty report doesn't refetch every order. Populated for free while
    // Cost Centers are fetched (same /Orders/Orders/Edit?id= page).
    var WARRANTY_CACHE_KEY = SCRIPT_ID + '-warranty-cache';
    var WARRANTY_CACHE_AGE_KEY = SCRIPT_ID + '-warranty-cache-age';

    // "Sub-Contract" flag per order (the Edit page has a service line whose
    // description is "Sub-Contract", e.g. code S-100238), cached the same way.
    // v2 key: the first v4.4 build cached fast-parse FALSE for every order before
    // line-injection was discovered, so a fresh key forces a clean re-evaluation.
    var SUBCONTRACT_CACHE_KEY = SCRIPT_ID + '-subcontract-cache-v2';
    var SUBCONTRACT_CACHE_AGE_KEY = SCRIPT_ID + '-subcontract-cache-v2-age';

    // PO subcontract flag, one per purchase order (NOT per order). A PO is a
    // subcontract when its /Orders/Orders/EditPO?id=<poId> page has a Parts line
    // whose Task chip reads "Sub-Contract" (title="Task">Sub-Contract</span> /
    // condensedCell td "Sub-Contract", Priced Per S-100238). Unlike the WO flag
    // (which only persists TRUE), this cache must store BOTH true and false: we
    // exclude the whole PO, so a false must not be re-fetched on every run.
    //
    // v2 schema: each cached id holds an OBJECT { subcontract: true|false,
    // completedDate: '', part: '' } so the Completed Date and the first part
    // description pulled from the same EditPO fetch are persisted alongside the
    // flag (bump forces one clean re-evaluation since v1 stored plain booleans).
    //
    // v3 key: the first v2 build used an exact class match for the part cell
    // (class="condensedCell") which Razor serves with a trailing space / extra
    // classes, so part cached EMPTY for every row; a fresh key forces one clean
    // re-evaluation so the loose-match parser backfills the part descriptions.
    //
    // v4 key: same masking under the v3 key (loose parser landed after the v3
    // entries were written), so bump again so a reinstall always rebuilds clean.
    //
    // v5 key: the Parts table is NOT in the main EditPO response (part cached
    // empty under v4); it is loaded via a PartArea handler fragment, so the v5
    // build fetches that fragment (when part is empty) and re-parses part +
    // Sub-Contract chip from it. Fresh key forces one clean re-evaluation.
    //
    // v6 key: cache object now also carries orderId (parsed from the EditPO
    // page's Order link) so the Order column links to /Orders/Orders/Edit?id=;
    // fresh key forces a clean rebuild since v5 entries lack orderId.
    var PO_SUBCONTRACT_CACHE_KEY = SCRIPT_ID + '-po-subcontract-cache-v6';
    var PO_SUBCONTRACT_CACHE_AGE_KEY = SCRIPT_ID + '-po-subcontract-cache-v6-age';

    // Order Uploads cache (per orderId): the uploaded document list
    // ({name, documentId}) shown in /Orders/Orders/Edit?id=<orderId>'s Uploads
    // section, used by the PO report's Document column. Kept SEPARATE from the
    // big PO cache on purpose: the doc list only covers OS- orders (Stock
    // stock transfers), changes far more often than PO metadata, and shares
    // small JSON payloads, so it gets a short TTL and must never invalidate the
    // expensive ~7k-entry PO cache.
    var ORDER_DOC_CACHE_KEY = SCRIPT_ID + '-order-doc-cache-v1';
    var ORDER_DOC_CACHE_AGE_KEY = SCRIPT_ID + '-order-doc-cache-v1-age';
    var ORDER_DOC_CACHE_MAX_AGE = 6 * 60 * 60 * 1000; // 6 hours

    // Excluded Vendors list for the Purchase Orders report. Vendors whose parts
    // never end up in customer units get added here (via the report panel's
    // "[x]" per-row link, the "Excluded Vendors" manager, or any caller) and are
    // OMITTED from every subsequent report run until removed. Plain array of
    // vendor names in GM storage; no expiry — intentional, it persists.
    var EXCLUDED_VENDORS_KEY = SCRIPT_ID + '-excluded-vendors';

    // ── PO "Remove Rows" exclusions (persisted; applied to every PO report run) ──
    // Each entry is a RULE: { id, kind, reason, addedAt, [text], [word], [poId], [poNumber] }
    //   kind 'blank-part'    -> hides every PO whose Part is empty
    //   kind 'part-contains' -> hides every PO whose Part contains `text`
    //                           (`word` = whole-word match, used by the Test set preset)
    //   kind 'po'            -> hides that one PO only (poId)
    var PO_ROW_EXCL_KEY = SCRIPT_ID + '-po-row-exclusions';
    var poRemoveModeOn = false;      // red-X column visible
    var poRemovedMgrOpen = false;    // "Removed Rows" drawer open
    var poRestoreScrollTop = null;   // keeps scroll position across a re-render

    function getPORowExclusions() {
        try {
            var raw = GM_getValue(PO_ROW_EXCL_KEY, null);
            var arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    }

    function savePORowExclusions(list) {
        try { GM_setValue(PO_ROW_EXCL_KEY, JSON.stringify(list || [])); } catch (e) {}
    }

    function poNormText(s) {
        return String(s == null ? '' : s).toLowerCase().replace(/[\s\-_]+/g, ' ').trim();
    }

    function poRuleMatches(rule, r) {
        if (!rule || !r) return false;
        if (rule.kind === 'blank-part') return !String(r.part || '').trim();
        if (rule.kind === 'part-contains') {
            var needle = poNormText(rule.text);
            var hay = poNormText(r.part);
            if (!needle || !hay) return false;
            if (rule.word) {
                var esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return new RegExp('(^|[^a-z0-9])' + esc + 's?([^a-z0-9]|$)').test(hay);
            }
            return hay.indexOf(needle) !== -1;
        }
        if (rule.kind === 'po') return !!rule.poId && r.id === rule.poId;
        return false;
    }

    function getExcludedVendors() {
        try {
            var raw = GM_getValue(EXCLUDED_VENDORS_KEY, null);
            var arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    }

    function saveExcludedVendors(list) {
        try {
            var clean = [];
            for (var i = 0; i < list.length; i++) {
                var v = String(list[i] || '').trim();
                if (v && clean.indexOf(v) === -1) clean.push(v);
            }
            GM_setValue(EXCLUDED_VENDORS_KEY, JSON.stringify(clean));
        } catch (e) {}
    }

    // Case-insensitive membership test for the exclude list.
    function isVendorExcluded(name) {
        var n = String(name || '').trim().toLowerCase();
        if (!n) return false;
        var list = getExcludedVendors();
        for (var i = 0; i < list.length; i++) {
            if (String(list[i]).trim().toLowerCase() === n) return true;
        }
        return false;
    }

    function addExcludedVendor(name) {
        var v = String(name || '').trim();
        if (!v) return getExcludedVendors();
        var list = getExcludedVendors();
        var lower = v.toLowerCase();
        var found = false;
        for (var i = 0; i < list.length; i++) {
            if (String(list[i]).trim().toLowerCase() === lower) { found = true; break; }
        }
        if (!found) list.push(v);
        saveExcludedVendors(list);
        return list;
    }

    function removeExcludedVendor(name) {
        var lower = String(name || '').trim().toLowerCase();
        var kept = [];
        getExcludedVendors().forEach(function (v) {
            if (String(v).trim().toLowerCase() !== lower) kept.push(v);
        });
        saveExcludedVendors(kept);
        return kept;
    }

    // Rep filter data from the app's User list (/Identity/Users?handler=ApplicationUsers).
    // Cached for a day so the Order Rep dropdown + "Exclude Front End" filtering work
    // without hitting the Users handler on every modal open or report run.
    var USERS_CACHE_KEY = SCRIPT_ID + '-users-cache';
    var USERS_CACHE_AGE_KEY = SCRIPT_ID + '-users-cache-age';
    var USERS_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 1 day
    var USERS = null;          // normalized User records (see fetchUsers)
    var USERS_PROMISE = null;  // memoized in-flight users fetch

    // Auditor View-Only mode: password-gated read-only switch. Stores a salted
    // hash of the unlock password (never the plaintext) plus the on/off state.
    // UI-only lockout — it hides the app's edit/save/delete controls; it cannot
    // stop a devtools-savvy user from calling edit endpoints directly.
    var AUDITOR_MODE_KEY = SCRIPT_ID + '-auditor-mode'; // 'on' | 'off'
    var AUDITOR_HASH_KEY = SCRIPT_ID + '-auditor-hash';
    var AUDITOR_SALT_KEY = SCRIPT_ID + '-auditor-salt';
    var AUDITOR_CSS_ID = SCRIPT_ID + '-auditor-css';

    function getCCCache() {
        try {
            var raw = GM_getValue(CC_CACHE_KEY, null);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }

    function setCCCache(mapping) {
        try {
            GM_setValue(CC_CACHE_KEY, JSON.stringify(mapping));
            GM_setValue(CC_CACHE_AGE_KEY, Date.now());
        } catch (e) {}
    }

    function clearCCCache() {
        try {
            GM_setValue(CC_CACHE_KEY, null);
            GM_setValue(CC_CACHE_AGE_KEY, null);
            clearCCProgress();
        } catch (e) {}
    }

    function isCCCacheStale() {
        try {
            var age = GM_getValue(CC_CACHE_AGE_KEY, 0);
            return !age || (Date.now() - age) > CC_CACHE_MAX_AGE;
        } catch (e) { return true; }
    }

    function getCCProgress() {
        try {
            var raw = GM_getValue(CC_CACHE_PROGRESS_KEY, null);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function setCCProgress(data) {
        try {
            GM_setValue(CC_CACHE_PROGRESS_KEY, JSON.stringify(data));
        } catch (e) {}
    }

    function clearCCProgress() {
        try { GM_setValue(CC_CACHE_PROGRESS_KEY, null); } catch (e) {}
    }

    function getWarrantyCache() {
        try {
            var raw = GM_getValue(WARRANTY_CACHE_KEY, null);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }

    function setWarrantyCache(mapping) {
        try {
            GM_setValue(WARRANTY_CACHE_KEY, JSON.stringify(mapping));
            GM_setValue(WARRANTY_CACHE_AGE_KEY, Date.now());
        } catch (e) {}
    }

    function clearWarrantyCache() {
        try {
            GM_setValue(WARRANTY_CACHE_KEY, null);
            GM_setValue(WARRANTY_CACHE_AGE_KEY, null);
        } catch (e) {}
    }

    function getSubcontractCache() {
        try {
            var raw = GM_getValue(SUBCONTRACT_CACHE_KEY, null);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }

    function setSubcontractCache(mapping) {
        try {
            GM_setValue(SUBCONTRACT_CACHE_KEY, JSON.stringify(mapping));
            GM_setValue(SUBCONTRACT_CACHE_AGE_KEY, Date.now());
        } catch (e) {}
    }

    function clearSubcontractCache() {
        try {
            GM_setValue(SUBCONTRACT_CACHE_KEY, null);
            GM_setValue(SUBCONTRACT_CACHE_AGE_KEY, null);
        } catch (e) {}
    }

    // ── PO subcontract flags (per purchase order, NOT per work order) ──
    // A purchase order is a SUBCONTRACT when its /Orders/Orders/EditPO?id=<poId>
    // page's Parts section has a line whose Task chip reads "Sub-Contract"
    // (<span ... title="Task">Sub-Contract</span>, the label-service-standard
    // chip rendered for that line, or the condensedCell td showing
    // "Sub-Contract" next to "Priced Per: S-100238"). POs found with such a
    // line are EXCLUDED from the Completed purchase-orders report entirely.
    //
    // Unlike the WO subcontract flag (which caches only TRUE because a WO's raw
    // page can't prove a negative), the PO flag MUST cache BOTH true AND false:
    // there are ~7,000 POs and every one requires its own EditPO fetch, so a
    // false left uncached would re-fetch the entire table on every run.
    function getPOSubcontractCache() {
        try {
            var raw = GM_getValue(PO_SUBCONTRACT_CACHE_KEY, null);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }

    function setPOSubcontractCache(mapping) {
        try {
            GM_setValue(PO_SUBCONTRACT_CACHE_KEY, JSON.stringify(mapping));
            GM_setValue(PO_SUBCONTRACT_CACHE_AGE_KEY, Date.now());
        } catch (e) {}
    }

    function clearPOSubcontractCache() {
        try {
            GM_setValue(PO_SUBCONTRACT_CACHE_KEY, null);
            GM_setValue(PO_SUBCONTRACT_CACHE_AGE_KEY, null);
        } catch (e) {}
    }

    // Order Uploads cache accessors. Entries are {docs: [{name, documentId}], ts}
    // so staleness is judged per order (a global age key alone would refetch every
    // order every 6h even when only a handful changed).
    function getOrderDocCache() {
        try {
            var raw = GM_getValue(ORDER_DOC_CACHE_KEY, null);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }

    function setOrderDocCache(mapping) {
        try {
            GM_setValue(ORDER_DOC_CACHE_KEY, JSON.stringify(mapping));
            GM_setValue(ORDER_DOC_CACHE_AGE_KEY, Date.now());
        } catch (e) {}
    }

    function clearOrderDocCache() {
        try {
            GM_setValue(ORDER_DOC_CACHE_KEY, null);
            GM_setValue(ORDER_DOC_CACHE_AGE_KEY, null);
        } catch (e) {}
    }

    function isOrderDocEntryFresh(entry) {
        return !!entry && Array.isArray(entry.docs) && !!entry.ts && (Date.now() - entry.ts) <= ORDER_DOC_CACHE_MAX_AGE;
    }

    // True when the EditPO HTML for a PO shows a subcontract line. The marker is
    // the "Task" chip on the parts line — <span class="label label-service-
    // standard" data-toggle="tooltip" title="Task">Sub-Contract</span> — or the
    // condensedCell td to its right showing exactly "Sub-Contract". We match
    // ONLY the Task chip, not a loose /Sub-Contract\b/ anywhere: the word also
    // appears as a Task chip on the WO-side for unrelated service lines, and on
    // a PO page every line has such a Task chip (Sub Category / Activity / Task /
    // Checklist), so only the line whose Task IS "Sub-Contract" counts.
    function isPOSubcontractLine(html) {
        if (!html) return false;
        return /<span\b[^>]*\btitle=["']Task["'][^>]*>\s*Sub-Contract\s*<\/span>/i.test(html) ||
               /<td\b[^>]*\bclass=["'][^"']*condensedCell[^"']*["'][^>]*>\s*Sub-Contract\s*<\/td>/i.test(html);
    }

    // Completed Date from the PO Info panel: the "Completed On" row's
    // form-control-static span (e.g. "<span class="form-control-static">
    // 2026-09-18</span>"). Falls back to any hidden input carrying the same
    // value when the span is empty.
    function parsePOCompletedDateFromHtml(html) {
        if (!html) return '';
        var m = /Completed\s*On\s*<\/th>[\s\S]{0,1200}?<span[^>]*class=["']form-control-static["'][^>]*>\s*([^<]*?)\s*<\/span>/i.exec(html);
        if (m && m[1]) {
            var v = m[1].trim();
            if (v) return v;
        }
        m = /name=["']PO\.PoHeader\.CompletedDate["'][^>]*value=["']([^"']*)["']/i.exec(html);
        return m && m[1] ? m[1].trim() : '';
    }

    // First part description from the EditPO Parts section: the condensedCell
    // td WITHOUT a width attribute on the parts description row (the "Priced
    // Per" / code cells carry width="150px"). Skips empty / label-only cells.
    // Matches the class loosely (server Razor often emits class="condensedCell "
    // or with extra classes), same approach as isPOSubcontractLine.
    function parsePOPartFromHtml(html) {
        if (!html) return '';
        var re = /<td\b[^>]*class=["'][^"']*condensedCell[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi;
        var m = null;
        while ((m = re.exec(html)) !== null) {
            var open = m[0].slice(0, m[0].indexOf('>') + 1);
            if (/\bwidth\s*=/.test(open)) continue;
            var text = (m[1] || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|\u00a0/gi, ' ').replace(/\s+/g, ' ').trim();
            if (text) return text;
        }
        return '';
    }

    // Order id from the EditPO page: the Order number renders as a link to
    // /Orders/Orders/Edit?id=<guid>, or is carried in a hidden OrderId input.
    function parsePOOrderIdFromHtml(html) {
        if (!html) return '';
        var m = /\/Orders\/Orders\/Edit\?id=([0-9a-fA-F-]{36})/i.exec(html);
        if (!m) m = /name=["'](?:PO\.)?(?:PoHeader\.)?OrderId["'][^>]*value=["']([0-9a-fA-F-]{36})["']/i.exec(html);
        return m && m[1] ? m[1].trim() : '';
    }

    // Single EditPO parse: returns { subcontract, completedDate, part }.
    function parsePOSubcontractFromHtml(html) {
        return {
            subcontract: isPOSubcontractLine(html),
            completedDate: parsePOCompletedDateFromHtml(html),
            part: parsePOPartFromHtml(html),
            orderId: parsePOOrderIdFromHtml(html)
        };
    }

    // Fetches the subcontract flag for a batch of purchase orders. Unlike the WO
    // pipe (which caches only TRUE), the PO cache MUST persist BOTH outcomes:
    // every Completed PO needs its own EditPO fetch and we EXCLUDE the whole PO,
    // so a false left uncached would re-fetch all ~7k POs on every run.
    var PO_SUBCONTRACT_PARALLEL = 6; // gentle; EditPO is heavier than the WO Edit page

    // The EditPO page renders only its PO Info panel inline; the Parts table
    // (task chips => subcontract flag, and the Part description cells) is loaded
    // separately by refreshPoLines() via a PartArea handler fragment, i.e.
    // $("#LinePartsArea").load("/Orders/Orders/EditPO?handler=PartArea&PoId=" ...).
    // So when the main response has no parts table, fetch the fragment and parse
    // the part + Sub-Contract chip from it, keeping the main page for CompletedDate.
    function fetchEditPOPartsFragment(poId) {
        return new Promise(function (resolve) {
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', '/Orders/Orders/EditPO?handler=PartArea&PoId=' + encodeURIComponent(poId), true);
                xhr.timeout = 8000;
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4) return;
                    if (xhr.status === 200) {
                        resolve({ html: xhr.responseText, error: null });
                    } else {
                        resolve({ html: '', error: 'partstatus-' + xhr.status });
                    }
                };
                xhr.onerror = function () { resolve({ html: '', error: 'partnetwork' }); };
                xhr.ontimeout = function () { resolve({ html: '', error: 'parttimeout' }); };
                xhr.send();
            } catch (e) { resolve({ html: '', error: 'partexception' }); }
        });
    }

    function fetchPOSubcontractForPO(poId) {
        return new Promise(function (resolve) {
            try {
                var url = '/Orders/Orders/EditPO?id=' + encodeURIComponent(poId);
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.timeout = 8000;
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4) return;
                    if (xhr.responseURL && xhr.responseURL.indexOf('/Orders/Orders/EditPO') === -1) {
                        resolve({ subcontract: false, completedDate: '', part: '', orderId: '', error: 'redirect' });
                        return;
                    }
                    if (xhr.status === 200) {
                        var html = xhr.responseText;
                        var r = parsePOSubcontractFromHtml(html);
                        if (!r.part) {
                            // Parts table not in the main response; re-parse from the
                            // PartArea fragment. Subcontract chips live ONLY in that
                            // fragment, so recompute the flag from it as well.
                            fetchEditPOPartsFragment(poId).then(function (p) {
                                if (p.error) {
                                    // Transient failure: leave uncached so it retries next run.
                                    resolve({ subcontract: r.subcontract, completedDate: r.completedDate, part: r.part, orderId: r.orderId, error: p.error });
                                    return;
                                }
                                resolve({
                                    subcontract: isPOSubcontractLine(p.html) || r.subcontract,
                                    completedDate: r.completedDate,
                                    part: parsePOPartFromHtml(p.html) || r.part,
                                    orderId: r.orderId,
                                    error: null
                                });
                            });
                            return;
                        }
                        resolve({
                            subcontract: r.subcontract,
                            completedDate: r.completedDate,
                            part: r.part,
                            orderId: r.orderId,
                            error: null
                        });
                    } else {
                        // Transient failure: leave uncached so it retries next run.
                        resolve({ subcontract: false, completedDate: '', part: '', error: 'status-' + xhr.status });
                    }
                };
                xhr.onerror = function () { resolve({ subcontract: false, completedDate: '', part: '', error: 'network' }); };
                xhr.ontimeout = function () { resolve({ subcontract: false, completedDate: '', part: '', error: 'timeout' }); };
                xhr.send();
            } catch (e) { resolve({ subcontract: false, completedDate: '', part: '', error: 'exception' }); }
        });
    }

    function fetchPOSubcontractBatch(poIds) {
        var cache = getPOSubcontractCache();
        var toFetch = poIds.filter(function (id) { return id && !(id in cache); });
        if (toFetch.length === 0) {
            return Promise.resolve(cache);
        }
        var idx = 0;
        function step() {
            if (idx >= toFetch.length) {
                setPOSubcontractCache(cache);
                return Promise.resolve(cache);
            }
            var batch = toFetch.slice(idx, idx + PO_SUBCONTRACT_PARALLEL);
            idx += PO_SUBCONTRACT_PARALLEL;
            return Promise.all(batch.map(function (id) {
                return fetchPOSubcontractForPO(id).then(function (result) {
                    if (!result.error) {
                        cache[id] = {
                            subcontract: result.subcontract === true, // persists true AND false
                            completedDate: result.completedDate || '',
                            part: result.part || '',
                            orderId: result.orderId || ''
                        };
                    }
                });
            })).then(step);
        }
        return step();
    }

    // ── Order Uploads / Document column ──
    // Fetches an order's Uploads document list. Preferred source is the Kendo
    // grid transport handler (/Orders/Orders/Edit?orderId=<oid>&handler=Documents)
    // — a small JSON array — with a full-page fallback (/Orders/Orders/Edit?id=
    // <oid>) for when that handler isn't available, parsing the server-rendered
    // ViewFile links. Resolves { docs: [{name, documentId}], ok } where ok is
    // false only when the request/parse hard-failed (callers then leave the
    // order uncached so it retries next run instead of caching "no documents").
    function fetchOrderDocumentsForOrder(orderId) {
        return new Promise(function (resolve) {
            function fail() { resolve({ docs: [], ok: false }); }
            function complete(html) {
                var out = [];
                try {
                    var body = JSON.parse(html);
                    var arr = Array.isArray(body) ? body : null;
                    if (!arr && body) {
                        if (Array.isArray(body.Data)) arr = body.Data;
                        else if (Array.isArray(body.data)) arr = body.data;
                        else if (Array.isArray(body.items)) arr = body.items;
                    }
                    if (arr) {
                        for (var i = 0; i < arr.length; i++) {
                            var it = arr[i];
                            if (it && (it.Id || it.id)) {
                                out.push({ name: it.Name || it.name || '', documentId: it.Id || it.id });
                            }
                        }
                    }
                } catch (e) {}
                if (!out.length) {
                    // Fallback: server-rendered documentsGrid ViewFile links.
                    var re = /href="\.\/Edit\?handler=ViewFile&(?:amp;)?documentId=([0-9a-fA-F-]{36})"[^>]*>([^<]+)<\/a>/g;
                    var m = null;
                    while ((m = re.exec(html)) !== null) {
                        out.push({ name: m[2].trim(), documentId: m[1] });
                    }
                }
                resolve({ docs: out, ok: true });
            }
            function fallbackToPage() {
                var fx = new XMLHttpRequest();
                fx.open('GET', '/Orders/Orders/Edit?id=' + encodeURIComponent(orderId), true);
                fx.timeout = 8000;
                fx.onreadystatechange = function () {
                    if (fx.readyState !== 4) return;
                    if (fx.status === 200) { try { complete(fx.responseText); } catch (e) { fail(); } }
                    else { fail(); }
                };
                fx.onerror = function () { fail(); };
                fx.ontimeout = function () { fail(); };
                try { fx.send(); } catch (e) { fail(); }
            }
            try {
                var url = '/Orders/Orders/Edit?orderId=' + encodeURIComponent(orderId) + '&handler=Documents';
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.timeout = 8000;
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4) return;
                    if (xhr.status !== 200) {
                        fallbackToPage();
                        return;
                    }
                    try { complete(xhr.responseText); } catch (e) { fail(); }
                };
                xhr.onerror = function () { fallbackToPage(); };
                xhr.ontimeout = function () { fallbackToPage(); };
                xhr.send();
            } catch (e) { fallbackToPage(); }
        });
    }

    // Parallel batch fetch for distinct order ids. Reads fresh entries from the
    // per-order cache, fetches only stale/absent ones, persists, and resolves the
    // full orderId → {docs} mapping.
    function fetchOrderDocsBatch(orderIds) {
        var cache = getOrderDocCache();
        var toFetch = orderIds.slice().filter(function (id) { return !isOrderDocEntryFresh(cache[id]); });
        function step() {
            if (toFetch.length === 0) {
                setOrderDocCache(cache);
                return Promise.resolve(cache);
            }
            var ids = toFetch.splice(0, PO_SUBCONTRACT_PARALLEL);
            return Promise.all(ids.map(function (id) {
                return fetchOrderDocumentsForOrder(id).then(function (result) {
                    if (result.ok) {
                        cache[id] = { docs: result.docs, ts: Date.now() };
                    }
                });
            })).then(step);
        }
        return step();
    }


    // Parses whether the order's Edit page has the "Is Warranty" checkbox checked.
    // The checkbox is server-rendered disabled, so its checked attribute is only
    // present when the order is actually flagged as warranty work.
    function parseWarrantyFromHtml(html) {
        if (!html) return false;
        var input = null;
        var th = /<th[^>]*>\s*Is\s+Warranty\s*<\/th>/i.exec(html);
        if (th) {
            var slice = html.slice(th.index);
            var td = /<td[^>]*>([\s\S]*?)<\/td>/i.exec(slice);
            var cell = td ? td[1] : slice.slice(0, 600);
            input = /<input\b[^>]*\btype=["']checkbox["'][^>]*>/i.exec(cell);
        }
        if (!input) {
            // Fallback: any checkbox near the AerospaceHead.IsWarranty validation field.
            input = /IsWarranty[\s\S]{0,600}?<input\b[^>]*\btype=["']checkbox["'][^>]*>/i.exec(html);
        }
        return !!input && /\bchecked\b/i.test(input[0]);
    }

    // Parses whether the order's Edit page has a "Sub-Contract" service line
    // (e.g. code S-100238). The line description is a <span class=bold>
    // Sub-Contract</span> inside the .lq-flex-card-row block. The markup uses
    // class WITHOUT quotes (class=bold), so match that span loosely. We do NOT
    // use a loose /Sub-Contract\b/ anywhere test: the word "Sub-Contract" also
    // appears as a "Task" chip on unrelated service/misc lines, which would
    // cause false positives.
    function isSubcontractLineSpan(html) {
        if (!html) return false;
        return /<span\b[^>]*\bclass=["']?bold["']?[^>]*>\s*Sub-Contract\s*<\/span>/i.test(html);
    }
    function parseSubcontractFromHtml(html) {
        return isSubcontractLineSpan(html);
    }

    function fetchCCForOrder(orderId) {
        return new Promise(function (resolve) {
            try {
                var url = '/Orders/Orders/Edit?id=' + orderId;
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.timeout = 8000;
                xhr.onreadystatechange = function () {
                    if (xhr.readyState === 4) {
                        // If the session expired, the server usually 302s to a login
                        // page; xhr follows it silently but responseURL reveals it.
                        if (xhr.responseURL && xhr.responseURL.indexOf('/Orders/Orders/Edit') === -1) {
                            console.error('[AUDIT] Cost Center fetch redirected off the order page (likely session expired) for order', orderId, '->', xhr.responseURL);
                            resolve({ cc: '', error: 'redirect' });
                            return;
                        }
                        if (xhr.status === 200) {
                            var m = xhr.responseText.match(/Cost Center[\s\S]*?<span[^>]*>(.*?)<\/span>/i);
                            if (!m) {
                                console.warn('[AUDIT] No "Cost Center" match on order', orderId, '(page may use different markup)');
                            }
                            resolve({ cc: m ? m[1].trim() : '', error: null, warranty: parseWarrantyFromHtml(xhr.responseText), subcontract: parseSubcontractFromHtml(xhr.responseText), _html: xhr.responseText });
                        } else {
                            console.error('[AUDIT] Cost Center fetch failed for order', orderId, 'status', xhr.status);
                            resolve({ cc: '', error: 'status-' + xhr.status });
                        }
                    }
                };
                xhr.onerror = function () {
                    console.error('[AUDIT] Cost Center fetch network error for order', orderId);
                    resolve({ cc: '', error: 'network' });
                };
                xhr.ontimeout = function () {
                    console.error('[AUDIT] Cost Center fetch timed out for order', orderId);
                    resolve({ cc: '', error: 'timeout' });
                };
                xhr.send();
            } catch (e) {
                console.error('[AUDIT] Cost Center fetch threw for order', orderId, e);
                resolve({ cc: '', error: 'exception' });
            }
        });
    }

    // First up-to-4 leading digits of a document's Name = the manual number the
    // report shows. e.g. '4084.pdf' -> '4084', '3514_Rev4.pdf' -> '3514',
    // '123.pdf' -> '123', '12345.pdf' -> '1234'.
    function extractManualNumber(name) {
        var m = String(name || '').match(/^\d{1,4}/);
        return m ? m[0] : '';
    }

    // Fetches an order's aero-documents grid (the #aeroDocsGrid shown in the HTML
    // snippet) via the Kendo transport handler and returns the manual number of
    // the "Selected" document (that's the green checkmark). Resolves
    // { num, ok }: num is '' when no document is selected; ok is false only when
    // the request/parse hard-failed (non-200 / network / timeout/ unparseable),
    // so callers leave the order UNCACHED and retry it next run instead of
    // caching a false "no manual".
    function fetchManualDocsForOrder(orderId) {
        return new Promise(function (resolve) {
            function fail() { resolve({ num: '', ok: false }); }
            try {
                var url = '/Orders/Orders/Edit?orderId=' + encodeURIComponent(orderId) + '&handler=AeroDocuments';
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.timeout = 8000;
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4) return;
                    if (xhr.status !== 200) {
                        console.warn('[AUDIT] AeroDocuments fetch failed for order', orderId, 'status', xhr.status);
                        fail();
                        return;
                    }
                    try {
                        var body = JSON.parse(xhr.responseText);
                        var docs = Array.isArray(body) ? body : (body && Array.isArray(body.Data) ? body.Data : []);
                        var selected = null;
                        for (var i = 0; i < docs.length; i++) {
                            if (docs[i] && docs[i].Selected === true) {
                                selected = docs[i];
                                break;
                            }
                        }
                        resolve({ num: selected ? extractManualNumber(selected.Name || '') : '', ok: true });
                    } catch (e) {
                        console.warn('[AUDIT] AeroDocuments response unparseable for order', orderId, e);
                        fail();
                    }
                };
                xhr.onerror = function () { fail(); };
                xhr.ontimeout = function () { fail(); };
                xhr.send();
            } catch (e) { fail(); }
        });
    }

    function fetchCCChunk(ids, cache, warrantyCache, subcontractCache, errorCounts) {
        var idx = 0;
        function next() {
            if (idx >= ids.length) return Promise.resolve();
            var batch = ids.slice(idx, idx + CC_PARALLEL);
            idx += CC_PARALLEL;
            return Promise.all(batch.map(function (id) {
                return fetchCCForOrder(id).then(function (result) {
                    if (result.error) {
                        // Transient failures are left uncached so they retry next run.
                        errorCounts[result.error] = (errorCounts[result.error] || 0) + 1;
                    } else {
                        // Cache even a blank cost center so it's fetched only once.
                        cache[id] = result.cc;
                        if (warrantyCache && typeof result.warranty === 'boolean') {
                            warrantyCache[id] = result.warranty;
                        }
                        if (subcontractCache && result.subcontract === true) {
                            // Only CONFIRM true flags here. Orders whose raw page
                            // lacks the term are left uncached so the Subcontracts
                            // report decides them via the LineArea fetch.
                            subcontractCache[id] = true;
                        }
                    }
                });
            })).then(next);
        }
        return next();
    }

    function fetchWarrantyBatch(orderIds) {
        var cache = getWarrantyCache();
        var toFetch = orderIds.filter(function (id) { return id && !(id in cache); });
        if (toFetch.length === 0) {
            return Promise.resolve(cache);
        }
        var idx = 0;
        function step() {
            if (idx >= toFetch.length) {
                setWarrantyCache(cache);
                return Promise.resolve(cache);
            }
            var batch = toFetch.slice(idx, idx + CC_PARALLEL);
            idx += CC_PARALLEL;
            return Promise.all(batch.map(function (id) {
                return fetchCCForOrder(id).then(function (result) {
                    if (!result.error && typeof result.warranty === 'boolean') {
                        cache[id] = result.warranty;
                    }
                });
            })).then(step);
        }
        return step();
    }

    function fetchSubcontractBatch(orderIds) {
        var cache = getSubcontractCache();
        var toFetch = orderIds.filter(function (id) { return id && !(id in cache); });
        if (toFetch.length === 0) {
            return Promise.resolve(cache);
        }
        var idx = 0;
        function step() {
            if (idx >= toFetch.length) {
                setSubcontractCache(cache);
                return Promise.resolve(cache);
            }
            var batch = toFetch.slice(idx, idx + CC_PARALLEL);
            idx += CC_PARALLEL;
            return Promise.all(batch.map(function (id) {
                return fetchCCForOrder(id).then(function (result) {
                    if (result.error) return;
                    if (result.subcontract === true) {
                        cache[id] = true;
                        return;
                    }
                    // The order line markup is NOT in the raw Edit page — the page
                    // loads it via Edit?handler=LineArea&OrderId=<order> (confirmed
                    // from the app's Network tab). Fetch that and test it.
                    if (result._html) {
                        return fetchSubcontractLineArea(id).then(function (text) {
                            if (text) cache[id] = isSubcontractLineSpan(text);
                            // empty text = error/timeout -> leave uncached to retry next run
                        });
                    }
                    cache[id] = false;
                });
            })).then(step);
        }
        return step();
    }

    // Renders the order's Lines area (item column incl. "Sub-Contract" descriptions).
    function fetchSubcontractLineArea(orderId) {
        return new Promise(function (resolve) {
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', '/Orders/Orders/Edit?handler=LineArea&OrderId=' + encodeURIComponent(orderId), true);
                xhr.timeout = 8000;
                xhr.onreadystatechange = function () {
                    if (xhr.readyState === 4) {
                        resolve(xhr.status === 200 ? (xhr.responseText || '') : '');
                    }
                };
                xhr.onerror = function () { resolve(''); };
                xhr.ontimeout = function () { resolve(''); };
                xhr.send();
            } catch (e) { resolve(''); }
        });
    }

    function fetchCCBatch(orderIds, onProgress) {
        var cache = getCCCache();
        var warrantyCache = getWarrantyCache();
        var subcontractCache = getSubcontractCache();
        var toFetch = orderIds.filter(function (id) { return id && !(id in cache); });

        if (toFetch.length === 0) {
            return Promise.resolve(cache);
        }

        var progress = getCCProgress();
        var startIdx = 0;
        if (progress && progress.total === toFetch.length) {
            startIdx = progress.done || 0;
        }

        var total = toFetch.length;
        var done = startIdx;
        var errorCounts = {};
        var lastProgressTs = Date.now();
        var stallWarned = false;

        var stallTimer = setInterval(function () {
            if (Date.now() - lastProgressTs > 30000 && !stallWarned) {
                stallWarned = true;
                var errSummary = Object.keys(errorCounts).map(function (k) { return k + ':' + errorCounts[k]; }).join(', ') || 'none logged yet';
                showToast('Cost Center cache has made no progress in 30s (' + done + '/' + total + '). Errors so far: ' + errSummary + '. Check the browser console for details.', 'warn');
            }
        }, 5000);

        function processChunk() {
            if (done >= total) {
                clearInterval(stallTimer);
                clearCCProgress();
                setCCCache(cache);
                if (Object.keys(warrantyCache).length) setWarrantyCache(warrantyCache);
                if (Object.keys(subcontractCache).length) setSubcontractCache(subcontractCache);
                var errSummary = Object.keys(errorCounts).map(function (k) { return k + ':' + errorCounts[k]; }).join(', ');
                if (errSummary) console.warn('[AUDIT] Cost Center cache finished with errors —', errSummary);
                return Promise.resolve(cache);
            }

            var chunkEnd = Math.min(done + CC_CHUNK_SIZE, total);
            var chunk = toFetch.slice(done, chunkEnd);

            return fetchCCChunk(chunk, cache, warrantyCache, subcontractCache, errorCounts).then(function () {
                done = chunkEnd;
                lastProgressTs = Date.now();
                stallWarned = false;
                setCCCache(cache);
                setWarrantyCache(warrantyCache);
                setSubcontractCache(subcontractCache);
                setCCProgress({ total: total, done: done, ts: Date.now() });
                if (onProgress) onProgress(done, total);
                return processChunk();
            }).catch(function (e) {
                clearInterval(stallTimer);
                console.error('[AUDIT] Cost Center cache chunk failed and stopped the batch', e);
                showToast('Cost Center caching stopped due to an error — check the console. Progress is saved; re-run to resume.', 'warn');
                throw e;
            });
        }

        if (onProgress) onProgress(done, total);
        return processChunk();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  WO RECONCILIATION  (legacy CSV vs. live app)
    //
    //  Cross-references a user-supplied legacy CSV export (columns include
    //  "WO#:", "DATE SHIPPED", "COMPANY1", "PART NUMBER", "SERIAL NUMBER",
    //  "P.O. NUMBER") against the live /Orders/Orders grid, matched on
    //  WO# === ProjectName. This does NOT depend on Bristow Status history —
    //  it's a separate check because the legacy CSV's "shipped" concept and
    //  the app's Bristow Status "Shipped" state are two different systems
    //  that don't stay in sync (confirmed: ~96% of legacy-shipped orders now
    //  sit at "Ready for Invoicing" live, never having a "Shipped" status
    //  entry at all).
    // ═══════════════════════════════════════════════════════════════════════

    // Bristow Status custom-field TemplateId (constant across live grid JSON).
    // Match by TemplateId first so field order doesn't matter; fall back to
    // position 0 (the v3.18-era getBristowStatus behavior) for safety.
    var BS_STATUS_TEMPLATE_ID = '163c36ee-9da1-4f1d-af53-08daafcb9127';

    function getWoBsStatusValue(r) {
        var cf = r && r.CustomFieldValues;
        if (!cf) return '';
        if (cf.length !== undefined) {
            for (var i = 0; i < cf.length; i++) {
                if (cf[i] && cf[i].TemplateId === BS_STATUS_TEMPLATE_ID && cf[i].Value != null) {
                    return String(cf[i].Value);
                }
            }
            var first = cf[0];
            return (first && first.Value != null) ? String(first.Value) : '';
        }
        if (cf.TemplateId === BS_STATUS_TEMPLATE_ID) return (cf.Value != null) ? String(cf.Value) : '';
        return (cf.Value != null) ? String(cf.Value) : '';
    }

    // Minimal CSV parser: handles quoted fields, embedded commas, and CRLF/LF.
    function parseCsv(text) {
        var rows = [];
        var row = [];
        var field = '';
        var inQuotes = false;
        for (var i = 0; i < text.length; i++) {
            var c = text[i];
            if (inQuotes) {
                if (c === '"') {
                    if (text[i + 1] === '"') { field += '"'; i++; }
                    else { inQuotes = false; }
                } else {
                    field += c;
                }
            } else {
                if (c === '"') inQuotes = true;
                else if (c === ',') { row.push(field); field = ''; }
                else if (c === '\r') { /* skip, \n handles the break */ }
                else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
                else field += c;
            }
        }
        if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
        if (!rows.length) return [];
        var headers = rows[0].map(function (h) { return h.replace(/^\uFEFF/, '').trim(); });
        var out = [];
        for (var r = 1; r < rows.length; r++) {
            if (rows[r].length === 1 && rows[r][0] === '') continue; // trailing blank line
            var obj = {};
            for (var c2 = 0; c2 < headers.length; c2++) obj[headers[c2]] = (rows[r][c2] || '').trim();
            out.push(obj);
        }
        return out;
    }

    // Legacy CSV's "DATE SHIPPED" is formatted like "Friday, June 05, 2026".
    function parseLegacyDate(s) {
        s = (s || '').trim();
        if (!s) return null;
        var d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }

    // Format any date-ish value as DD-Mon-YYYY (abbreviated, e.g. 23-OCT-2024).
    // Accepts Date, ISO timestamp (2024-10-23T15:04...), or human text
    // (Friday, June 05, 2026). Returns '' if it can't be parsed.
    function fmtReconDate(s) {
        if (s == null || s === '') return '';
        var d;
        if (s instanceof Date) d = s;
        else {
            d = new Date(s);
            if (isNaN(d.getTime())) return String(s);
        }
        if (isNaN(d.getTime())) return String(s);
        return toDisplayDate(d).toUpperCase();
    }

    function runWoReconciliation(csvText, onProgress) {
        var csvRows = parseCsv(csvText);
        if (onProgress) onProgress('Parsed ' + csvRows.length + ' CSV rows. Fetching live order grid…');
        return fetchOrdersGridData().then(function (gridRes) {
            if (gridRes.error) throw new Error('Failed to fetch live order grid: ' + gridRes.error);
            var grid = gridRes.rows || [];
            var ccCache = getCCCache();
            var gridByWo = {};
            grid.forEach(function (o) {
                var wo = String(o.ProjectName || '').trim();
                if (!wo) return;
                if (!gridByWo[wo]) gridByWo[wo] = [];
                gridByWo[wo].push(o);
            });
            if (onProgress) onProgress('Matching ' + csvRows.length + ' CSV rows against ' + grid.length + ' live orders…');
            var outRows = [];
            var seenWo = {};
            var counts = { matched: 0, missing: 0, multi: 0 };
            function liveCompany(m) {
                return (m.Company && typeof m.Company === 'object' && m.Company.Name != null) ? String(m.Company.Name) : (m.Company != null ? String(m.Company) : '');
            }
            function liveOffice(m) {
                return m.PrimaryOffice != null ? (m.PrimaryOffice.Name != null ? String(m.PrimaryOffice.Name) : String(m.PrimaryOffice)) : '';
            }
            function liveComponent(m) {
                return (m.Aero && m.Aero.Component != null) ? String(m.Aero.Component) : '';
            }
            function liveSerial(m) {
                return (m.Aero && m.Aero.SerialNumber != null) ? String(m.Aero.SerialNumber) : '';
            }
            csvRows.forEach(function (r) {
                var wo = (r['WO#:'] || '').trim();
                if (!wo) return;
                var shipRaw = (r['DATE SHIPPED'] || '').trim();
                var shipDate = fmtReconDate(shipRaw);
                var csvCompany = r['COMPANY1'] || '';
                var csvPart = r['PART NUMBER'] || '';
                var csvSerial = r['SERIAL NUMBER'] || '';
                var csvPo = r['P.O. NUMBER'] || '';
                var matches = gridByWo[wo] || [];
                if (!seenWo[wo]) {
                    seenWo[wo] = true;
                    if (!matches.length) counts.missing++;
                    else { counts.matched++; if (matches.length > 1) counts.multi++; }
                }
                if (!matches.length) {
                    outRows.push({
                        wo: wo, status: 'MISSING_FROM_LIVE_APP',
                        liveOrderNumber: '', liveOrderStatus: '', liveBristowStatus: '',
                        liveOffice: '', liveCreated: '', liveCreatedRaw: '', liveCompany: '',
                        liveRep: '', costCenter: '', component: '', serialNo: '', orderId: '',
                        csvCompany: csvCompany, csvShipped: shipRaw, shippedDate: shipDate,
                        csvPart: csvPart, csvSerial: csvSerial, csvPo: csvPo
                    });
                    return;
                }
                matches.forEach(function (m) {
                    outRows.push({
                        wo: wo,
                        status: matches.length > 1 ? 'MATCHED_MULTIPLE_LIVE_ORDERS' : 'MATCHED',
                        liveOrderNumber: m.OrderNumber || '',
                        liveOrderStatus: m.OrderStatusName || '',
                        liveBristowStatus: getWoBsStatusValue(m),
                        liveOffice: liveOffice(m),
                        liveCreated: fmtReconDate(m.CreatedAt),
                        liveCreatedRaw: m.CreatedAt || '',
                        liveCompany: liveCompany(m),
                        liveRep: m.OrderRep != null ? String(m.OrderRep) : '',
                        costCenter: (ccCache && ccCache[m.Id]) || '',
                        component: liveComponent(m),
                        serialNo: liveSerial(m),
                        orderId: m.Id || '',
                        csvCompany: csvCompany, csvShipped: shipRaw, shippedDate: shipDate,
                        csvPart: csvPart, csvSerial: csvSerial, csvPo: csvPo
                    });
                });
            });
            return { rows: outRows, counts: counts, totalCsv: Object.keys(seenWo).length };
        });
    }

    // Renders the reconciliation result as an on-page panel (like the merged
    // Work Orders table) with a Summary + Detail xlsx export.
    function presentWoReconciliation(result) {
        var PANEL_ID = SCRIPT_ID + '-recon-panel';
        var existing = document.getElementById(PANEL_ID);
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

        var statusCounts = {};
        result.rows.forEach(function (row) {
            if (row.status === 'MATCHED' || row.status === 'MATCHED_MULTIPLE_LIVE_ORDERS') {
                var k = row.liveBristowStatus || '(blank)';
                statusCounts[k] = (statusCounts[k] || 0) + 1;
            }
        });
        var statusList = Object.keys(statusCounts).sort(function (a, b) { return statusCounts[b] - statusCounts[a]; });

        var summary = 'Total CSV work orders: ' + result.totalCsv
            + ' | Matched: ' + result.counts.matched
            + ' (multi: ' + result.counts.multi + ')'
            + ' | Missing from live: ' + result.counts.missing;

        var thead = '<tr>'
            + '<th>#</th><th>LQ Order No.</th><th>WO#</th><th>Company</th><th>LQ Order Rep</th>'
            + '<th>Cost Center</th><th>LQ Office</th><th>Component</th><th>Serial No.</th>'
            + '<th>LQ Order Status</th><th>LQ Bristow Status</th><th>LQ Created</th>'
            + '<th>CSV Date Shipped</th><th>Shipped Date</th>'
            + '</tr>';

        var tbody = '';
        result.rows.forEach(function (row, i) {
            var statusColor = row.status.indexOf('MISSING') !== -1 ? '#c0392b'
                : (row.status.indexOf('MULTIPLE') !== -1 ? '#e67e22' : '#27ae60');
            tbody += '<tr>'
                + '<td>' + (i + 1) + '</td>'
                + '<td class="aoc-mono" style="color:' + statusColor + ';">' + row.liveOrderNumber + '</td>'
                + '<td class="aoc-mono">' + row.wo + '</td>'
                + '<td>' + (row.liveCompany || row.csvCompany) + '</td>'
                + '<td>' + row.liveRep + '</td>'
                + '<td>' + row.costCenter + '</td>'
                + '<td>' + row.liveOffice + '</td>'
                + '<td>' + row.component + '</td>'
                + '<td class="aoc-mono">' + row.serialNo + '</td>'
                + '<td>' + row.liveOrderStatus + '</td>'
                + '<td>' + row.liveBristowStatus + '</td>'
                + '<td class="aoc-mono">' + row.liveCreated + '</td>'
                + '<td class="aoc-mono">' + row.csvShipped + '</td>'
                + '<td class="aoc-mono">' + row.shippedDate + '</td>'
                + '</tr>';
        });

        var panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483646;background:rgba(0,0,0,0.4);display:flex;align-items:flex-start;justify-content:center;padding:24px;font-family:Arial,sans-serif;';
        var statusHtml = statusList.map(function (k) { return k + '=' + statusCounts[k]; }).join('  |  ');
        panel.innerHTML =
            '<div style="background:#fff;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,0.4);width:98%;max-width:1600px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;">'
            + '<div style="padding:12px 16px;border-bottom:1px solid #ddd;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">'
            + '<div style="font-size:15px;font-weight:600;color:#222;">WO Reconciliation (CSV vs Live App) — ' + result.rows.length + ' rows</div>'
            + '<div style="font-size:12px;color:#667;' + (result.counts.missing ? 'font-weight:600;color:#c0392b;' : '') + '">' + summary + '</div>'
            + '<div style="display:flex;gap:8px;">'
            + '<button id="' + PANEL_ID + '-export" style="background:#27ae60;color:#fff;border:none;padding:7px 14px;border-radius:4px;cursor:pointer;font-size:12px;">Export to Excel</button>'
            + '<button id="' + PANEL_ID + '-close" style="background:#666;color:#fff;border:none;padding:7px 14px;border-radius:4px;cursor:pointer;font-size:12px;">Close</button>'
            + '</div></div>'
            + '<div style="padding:8px 16px;border-bottom:1px solid #eee;font-size:12px;color:#555;background:#f8f9fa;">Live Bristow Status of matched CSV orders: <b>' + (statusHtml || '(none matched)') + '</b></div>'
            + '<div style="overflow:auto;flex:1;">'
            + '<table style="border-collapse:collapse;width:100%;font-size:12px;min-width:1400px;">'
            + '<thead style="position:sticky;top:0;background:#fff;">' + thead + '</thead>'
            + '<tbody>' + tbody + '</tbody>'
            + '</table></div>'
            + '</div>';

        var ths = panel.querySelectorAll('thead th');
        for (var k = 0; k < ths.length; k++) {
            ths[k].style.cssText = 'background:#378ADD;color:#fff;padding:7px 10px;text-align:left;border-bottom:1px solid #999;font-weight:600;font-size:12px;white-space:nowrap;';
        }
        var tds = panel.querySelectorAll('tbody td');
        for (var j = 0; j < tds.length; j++) {
            tds[j].style.cssText = 'padding:5px 10px;border-bottom:1px solid #eee;vertical-align:top;';
            if (tds[j].classList.contains('aoc-mono')) tds[j].style.fontFamily = 'Consolas, monospace';
        }
        var evens = panel.querySelectorAll('tbody tr:nth-child(even)');
        for (var e = 0; e < evens.length; e++) evens[e].style.background = '#f5f8fc';

        document.body.appendChild(panel);

        setTimeout(function () {
            document.getElementById(PANEL_ID + '-export').onclick = function () {
                exportWoReconciliation(result);
            };
            document.getElementById(PANEL_ID + '-close').onclick = function () {
                var p = document.getElementById(PANEL_ID);
                if (p && p.parentNode) p.parentNode.removeChild(p);
            };
        }, 0);
    }

    function exportWoReconciliation(result) {
        try {
            if (typeof XLSX === 'undefined') {
                showToast('Excel library (SheetJS) not loaded — check the userscript @require', 'warn');
                return;
            }
            var base = location.origin;
            var headers = ['#', 'LQ Order No.', 'WO#', 'Company', 'LQ Order Rep', 'Cost Center',
                'LQ Office', 'Component', 'Serial No.', 'LQ Order Status', 'LQ Bristow Status',
                'LQ Created', 'CSV Date Shipped', 'Shipped Date'];
            var aoa = [headers];
            result.rows.forEach(function (r, i) {
                aoa.push([
                    i + 1,
                    r.liveOrderNumber,
                    r.wo,
                    r.liveCompany || r.csvCompany,
                    r.liveRep,
                    r.costCenter,
                    r.liveOffice,
                    r.component,
                    r.serialNo,
                    r.liveOrderStatus,
                    r.liveBristowStatus,
                    r.liveCreated,
                    r.csvShipped,
                    r.shippedDate
                ]);
            });
            var ws = XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = [
                { wch: 6 }, { wch: 18 }, { wch: 16 }, { wch: 36 }, { wch: 20 }, { wch: 12 },
                { wch: 20 }, { wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 18 },
                { wch: 16 }, { wch: 20 }, { wch: 16 }
            ];
            ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: headers.length - 1 } }) };
            // Hyperlink each live order number to its Edit page.
            result.rows.forEach(function (r, i) {
                if (!r.orderId) return;
                var cell = XLSX.utils.encode_cell({ r: i + 1, c: 1 });
                ws[cell] = { t: 's', v: r.liveOrderNumber, l: { Target: base + '/Orders/Orders/Edit?id=' + encodeURIComponent(r.orderId) } };
            });

            var wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Reconciliation');
            var fname = 'WO-Reconciliation-' + new Date().toISOString().slice(0, 10) + '.xlsx';
            XLSX.writeFile(wb, fname);
            showToast('Exported ' + result.rows.length + ' rows to ' + fname, 'success');
        } catch (e) {
            console.error('[AUDIT] Reconciliation export failed', e);
            showToast('Reconciliation export failed: ' + e.message, 'warn');
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  SHIPPED DATE  (from each order's Bristow Status field history)
    //
    //  The Communication Report is NOT used — it proved unreliable as a shipped
    //  list (duplicate rows, loose comment matches, missing orders). Instead,
    //  the Work Orders grid is the primary source and each order's shipped date
    //  is recovered from its Bristow Status _StatusHistory popup. The Id is the
    //  order's Bristow Status custom-field Id, resolved from the Edit page
    //  (the grid row's CustomFieldValues[0] never serializes it).
    // ═══════════════════════════════════════════════════════════════════════

    var HIST_CACHE_KEY = SCRIPT_ID + '-hist-cache';
    var HIST_CACHE_VERSION = 1;            // bump when cached payload shape changes
    var HIST_LOOKBACK_DAYS = 120;          // how far before rangeStart to scan candidate CreatedAt
    var HIST_PARALLEL = 6;                 // concurrent edit/history lookups (kept modest to avoid hammering the server)
    var HIST_TRIP_AT = 8;                  // consecutive request failures before backing off
    var HIST_MAX_GAP = 15000;              // cap on the back-off pause (ms)

    // An all-zero GUID means the order has no Bristow Status field defined at all,
    // so there is no history to fetch — treat it as "no shipped" without a request.
    function isZeroGuid(id) {
        return !id || /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(String(id).trim());
    }

    function getHistCache() {
        try {
            var raw = GM_getValue(HIST_CACHE_KEY, null);
            if (!raw) return {};
            var parsed = JSON.parse(raw);
            if (parsed && parsed.v === HIST_CACHE_VERSION && parsed.ships) return parsed.ships;
            return {};
        } catch (e) { return {}; }
    }

    function saveHistCache(ships) {
        try { GM_setValue(HIST_CACHE_KEY, JSON.stringify({ v: HIST_CACHE_VERSION, ships: ships })); } catch (e) {}
    }

    function clearHistCache() {
        try { GM_setValue(HIST_CACHE_KEY, null); } catch (e) {}
    }

    // Per-order Bristow Status field-Id cache. The grid never serializes the
    // field Id, so we recover it from the Edit page ONCE per order and reuse it
    // on later runs (a failed _StatusHistory shouldn't force a repeat Edit fetch).
    var FIELD_CACHE_KEY = SCRIPT_ID + '-hist-fields';
    var pendingFields = {};

    function getFieldCache() {
        try {
            var raw = GM_getValue(FIELD_CACHE_KEY, null);
            if (!raw) return {};
            var parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) { return {}; }
    }

    function flushPendingFields() {
        if (!Object.keys(pendingFields).length) return;
        try {
            var merged = getFieldCache();
            Object.keys(pendingFields).forEach(function (k) { merged[k] = pendingFields[k]; });
            GM_setValue(FIELD_CACHE_KEY, JSON.stringify(merged));
            pendingFields = {};
        } catch (e) {}
    }

    function clearFieldCache() {
        try { GM_setValue(FIELD_CACHE_KEY, null); } catch (e) {}
        try { pendingFields = {}; } catch (e) {}
    }

    // Export / import the Bristow Status history cache (back up or move it to
    // another machine/browser without re-scanning the whole backlog).
    // ── Manual (aero-documents) cache ──
    // The "Manual Used" number per order = the first up-to-4 digits of the
    // Name of the order's Selected aero-document. Cached keyed by order Id
    // (like Cost Center/Warranty) so re-runs don't refetch every shipped
    // order. Hard failures are left uncached so they self-heal next run.
    var MANUAL_CACHE_KEY = SCRIPT_ID + '-manual-cache';
    var MANUAL_CACHE_VERSION = 1;

    function getManualCache() {
        try {
            var raw = GM_getValue(MANUAL_CACHE_KEY, null);
            if (!raw) return {};
            var parsed = JSON.parse(raw);
            if (parsed && parsed.v === MANUAL_CACHE_VERSION && parsed.manuals) return parsed.manuals;
            if (parsed && typeof parsed === 'object' && !parsed.v) return parsed;   // tolerate bare {id: num} maps
            return {};
        } catch (e) { return {}; }
    }

    function setManualCache(manuals) {
        try { GM_setValue(MANUAL_CACHE_KEY, JSON.stringify({ v: MANUAL_CACHE_VERSION, manuals: manuals })); } catch (e) {}
    }

    function clearManualCache() {
        try { GM_setValue(MANUAL_CACHE_KEY, null); } catch (e) {}
    }

    // Fetches manuals for the ids not already cached (batched at CC_PARALLEL),
    // persists, and resolves the merged { id: manualNumber } map.
    function resolveManualsByIds(ids, onProgress) {
        var cache = getManualCache();
        var missing = ids.filter(function (id) { return id && !(id in cache); });
        if (!missing.length) return Promise.resolve(cache);
        var idx = 0;
        var total = missing.length;
        var lastProgressTs = Date.now();
        function step() {
            if (idx >= total) { setManualCache(cache); return Promise.resolve(cache); }
            var batch = missing.slice(idx, idx + CC_PARALLEL);
            idx += CC_PARALLEL;
            return Promise.all(batch.map(function (id) {
                return fetchManualDocsForOrder(id).then(function (res) {
                    if (res && res.ok) cache[id] = res.num;
                });
            })).then(function () {
                if (onProgress && Date.now() - lastProgressTs > 3000) {
                    lastProgressTs = Date.now();
                    onProgress(Math.min(idx, total), total);
                }
                return step();
            });
        }
        return step();
    }

    // Pull the Bristow Status custom-field Id out of a grid row's CustomFieldValues.
    function getWoBsFieldId(r) {
        var cf = r.CustomFieldValues;
        if (!cf) return '';
        if (getWoBsFieldId._logOnce === undefined) {
            getWoBsFieldId._logOnce = true;
            try {
                var first = (cf.length !== undefined) ? cf[0] : cf;
                console.log('[AUDIT-HIST] CustomFieldValues[0] sample =', JSON.stringify(first));
            } catch (e) {}
        }
        function idOf(o) { return (o && o.Id != null) ? String(o.Id) : ''; }
        if (cf.length !== undefined) {
            for (var i = 0; i < cf.length; i++) {
                var l = (cf[i] && (cf[i].Label || cf[i].FieldName || '')) || '';
                if (/bristow\s*status/i.test(l)) return idOf(cf[i]);
            }
            return cf.length ? idOf(cf[0]) : '';
        }
        return idOf(cf);
    }

    // Fetches one order's Bristow Status history and returns the "Shipped"
    // transition date, or null if the response has no Shipped entry. Resolves
    // { ok:false } for non-200 (503/timeout/network) so callers leave the order
    // UNCACHED and retry on a later run instead of wrongly caching "no shipped".
    // Transient failures (5xx/timeout/network) get up to 2 extra attempts with
    // backoff so a busy server self-heals within the same run.
    function fetchStatusHistoryShipDate(fieldId) {
        return new Promise(function (resolve) {
            if (!fieldId) return resolve({ ok: false, date: null });
            var attempts = 0;
            function attempt() {
                attempts++;
                var xhr = new XMLHttpRequest();
                try {
                    xhr.open('GET', '/Orders/Shared/_StatusHistory?Id=' + encodeURIComponent(fieldId) + '&_=' + Date.now(), true);
                } catch (e) {
                    return resolve({ ok: false, date: null, error: 'exception' });
                }
                xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
                xhr.timeout = 60000;
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4) return;
                    if (xhr.status === 200) return resolve({ ok: true, date: parseStatusHistoryShipDate(xhr.responseText) });
                    if (xhr.status >= 500 && attempts < 3) return setTimeout(attempt, 1500 * attempts);
                    resolve({ ok: false, date: null, status: xhr.status });
                };
                xhr.onerror = function () {
                    if (attempts < 3) return setTimeout(attempt, 1500 * attempts);
                    resolve({ ok: false, date: null, error: 'network' });
                };
                xhr.ontimeout = function () {
                    if (attempts < 3) return setTimeout(attempt, 1500 * attempts);
                    resolve({ ok: false, date: null, error: 'timeout' });
                };
                xhr.send();
            }
            attempt();
        });
    }

    // The Bristow Status custom-field Id lives on the order's Edit page as
    // #OrderHead_CustomFields_0__Id (the grid row usually does NOT serialize it,
    // so we fall back to fetching it here when the grid didn't carry it). Returns
    // the field GUID ('' if the page says nothing).
    function fetchBsFieldIdFromEdit(orderId) {
        return new Promise(function (resolve) {
            if (!orderId) return resolve({ id: '', status: 0 });
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', '/Orders/Orders/Edit?id=' + encodeURIComponent(orderId), true);
                xhr.timeout = 60000;
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4) return;
                    if (xhr.status !== 200) return resolve({ id: '', status: xhr.status });
                    var m = xhr.responseText.match(/id=["']OrderHead_CustomFields_0__Id["'][^>]*value=["']([^"']*)["']/i);
                    if (m && m[1]) {
                        console.log('[AUDIT-HIST] field Id for order', orderId, '=', m[1]);
                        return resolve({ id: m[1], status: 200 });
                    }
                    try {
                        var doc = new DOMParser().parseFromString(xhr.responseText, 'text/html');
                        var el = doc.querySelector('#OrderHead_CustomFields_0__Id');
                        if (el) {
                            var v = el.getAttribute('value') || el.value || '';
                            console.log('[AUDIT-HIST] field Id (DOM) for order', orderId, '=', v);
                            return resolve({ id: v, status: 200 });
                        }
                    } catch (e) {}
                    return resolve({ id: '', status: 200 });
                };
                xhr.onerror = function () { resolve({ id: '', status: 0 }); };
                xhr.ontimeout = function () { resolve({ id: '', status: 0 }); };
                xhr.send();
            } catch (e) { resolve({ id: '', status: 0 }); }
        });
    }

    // Resolve one candidate: (1) use the grid field Id if present, else fetch the
    // Edit page for it; (2) if we got an Id, fetch its status history. Returns
    // { no, date, resolved } where resolved=false means we never got a field Id
    // (so the order is left uncached and retried next run rather than being told
    // "no shipped").
    function fetchShipDateForOrder(c) {
        return new Promise(function (resolve) {
            var fieldId = c.fieldId || '';
            if (fieldId && isZeroGuid(fieldId)) return resolve({ no: c.no, date: null, resolved: true });
            if (!fieldId) {
                if (!c.orderId) return resolve({ no: c.no, date: null, resolved: false });
                // Reuse a field Id recovered from a previous run's Edit fetch.
                var cachedFields = getFieldCache();
                var cached = cachedFields[c.orderId];
                if (cached && !isZeroGuid(cached)) {
                    return fetchStatusHistoryShipDate(cached).then(function (d) {
                        resolve({ no: c.no, date: d ? d.date : null, resolved: !!(d && d.ok) });
                    });
                }
                return fetchBsFieldIdFromEdit(c.orderId).then(function (r) {
                    var id = r.id || '';
                    if (!id) return resolve({ no: c.no, date: null, resolved: false, status: r.status });
                    if (isZeroGuid(id)) return resolve({ no: c.no, date: null, resolved: true });
                    pendingFields[c.orderId] = id;   // remember for later runs
                    return fetchStatusHistoryShipDate(id).then(function (d) {
                        resolve({ no: c.no, date: d ? d.date : null, resolved: !!(d && d.ok) });
                    });
                });
            }
            return fetchStatusHistoryShipDate(fieldId).then(function (d) {
                resolve({ no: c.no, date: d ? d.date : null, resolved: !!(d && d.ok) });
            });
        });
    }

    function parseStatusHistoryShipDate(html) {
        try {
            var doc = new DOMParser().parseFromString(String(html), 'text/html');
            var groups = doc.querySelectorAll('.history-group');
            var best = null;
            for (var i = 0; i < groups.length; i++) {
                var g = groups[i];
                var valEl = g.querySelector('.history-value');
                var dateEl = g.querySelector('.history-date');
                if (!valEl || !dateEl) continue;
                if (String(valEl.textContent || '').trim().toLowerCase() !== 'shipped') continue;
                var d = parseStatusDate(String(dateEl.textContent || '').trim());
                if (d && !isNaN(d.getTime()) && (!best || d.getTime() > best.getTime())) best = d;
            }
            return best;
        } catch (e) { return null; }
    }

    // "24-AUG-2026 7:31 PM" or "2025-05-21 1:01 AM" -> Date
    function parseStatusDate(s) {
        var h, ap;
        // Pattern 1: "24-AUG-2026 7:31 PM" (old format)
        var m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)?/i.exec(s);
        if (m) {
            var mo = MONTHS_MAP[(m[2] || '').toUpperCase()];
            if (mo === undefined) return null;
            h = parseInt(m[4], 10);
            ap = (m[6] || '').toUpperCase();
            if (ap === 'PM' && h < 12) h += 12;
            if (ap === 'AM' && h === 12) h = 0;
            return new Date(parseInt(m[3], 10), mo, parseInt(m[1], 10), h, parseInt(m[5], 10), 0, 0);
        }
        // Pattern 2: "2025-05-21 1:01 AM" (ISO-like, observed in live _StatusHistory)
        m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*([AP]M)?/i.exec(s);
        if (m) {
            h = parseInt(m[4], 10);
            ap = (m[6] || '').toUpperCase();
            if (ap === 'PM' && h < 12) h += 12;
            if (ap === 'AM' && h === 12) h = 0;
            return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), h, parseInt(m[5], 10), 0, 0);
        }
        return null;
    }

    // Batched, cached scan of unmatched orders' status history. Returns a
    // Promise< map orderNo -> Date > of orders whose history shows a Shipped
    // transition within [fromDate, toDate]. Results are persisted so re-runs
    // don't refetch.
    function fetchStatusHistoryShipDates(candidates, dates, onProgress) {
        var from = dates ? dates.start : null;
        var to = dates ? dates.end : null;
        var lo = from ? new Date(from) : null;
        var hi = to ? new Date(to) : null;
        if (lo) lo.setHours(0, 0, 0, 0);
        if (hi) hi.setHours(23, 59, 59, 999);
        function inRange(d) {
            var t = d.getTime();
            if (lo && t < lo.getTime()) return false;
            if (hi && t > hi.getTime()) return false;
            return true;
        }

        var ships = getHistCache();
        var toFetch = candidates.filter(function (c) { return !(c.no in ships); });
        var out = {};

        Object.keys(ships).forEach(function (no) {
            if (!ships[no]) return;                    // cached "no shipped"
            var d = new Date(ships[no]);
            if (!isNaN(d.getTime()) && inRange(d)) out[no] = d;
        });

        var idx = 0;
        var lastPct = -1;
        var lastSave = 0;
        var unresolvedCount = 0;
        var backoffLevel = 0;
        function pct() { return toFetch.length ? Math.floor(idx * 100 / toFetch.length / 5) : -1; }  // every ~5%
        function step() {
            if (idx >= toFetch.length) {
                saveHistCache(ships);
                flushPendingFields();
                if (unresolvedCount > 0) {
                    console.log('[AUDIT-HIST] ' + unresolvedCount + ' of ' + toFetch.length +
                        ' orders left uncached (server errors) — will retry on next run');
                }
                return Promise.resolve(out);
            }
            var slice = toFetch.slice(idx, idx + HIST_PARALLEL);
            idx += HIST_PARALLEL;
            if (onProgress && pct() !== lastPct) {
                lastPct = pct();
                onProgress(Math.min(idx, toFetch.length), toFetch.length);
            }
            if (idx - lastSave >= 1000) { lastSave = idx; saveHistCache(ships); flushPendingFields(); }
            return Promise.all(slice.map(function (c) {
                return fetchShipDateForOrder(c).then(function (res) {
                    var d = res.date;
                    if (!res.resolved) { unresolvedCount++; return { ok: false }; }  // server error — leave uncached, retry next run
                    if (d && !isNaN(d.getTime())) {
                        ships[c.no] = d.toISOString();
                        if (inRange(d)) out[c.no] = d;
                    } else {
                        ships[c.no] = null;
                    }
                    return { ok: true };
                });
            })).then(function (results) {
                // If the server/CDN keeps rejecting a whole slice, back off so we
                // don't blast thousands of failing requests into the rate limiter.
                var allFailed = results.length > 0 && results.every(function (r) { return r && r.ok === false; });
                if (allFailed) {
                    backoffLevel++;
                    var waitMs = Math.min(HIST_MAX_GAP, 800 * backoffLevel * backoffLevel);
                    console.warn('[AUDIT-HIST] server rejecting requests (slice ' + Math.floor(idx / HIST_PARALLEL) +
                        '), backing off ' + waitMs + 'ms before continuing');
                    return new Promise(function (resolve) { setTimeout(resolve, waitMs); }).then(step);
                }
                backoffLevel = 0;
                return step();
            });
        }
        return step();
    }

    // Build the candidate list (completed orders not already in the shipped map)
    // and fetch their status history. woMap is already bounded to the completed
    // set, and inRange() inside the fetcher only keeps orders whose Shipped
    // transition falls within the user's date range, so scanning the whole
    // unmatched set is safe — it just means the FIRST run fetches more, and the
    // per-order result is cached for instant re-runs.
    function expandShipDatesFromHistory(woMap, dates, knownMap, forceRefresh) {
        showProgress('Checking Bristow Status history for unmatched orders...');
        if (forceRefresh) { clearHistCache(); clearFieldCache(); }
        var candidates = [];
        var winEnd = null;
        if (dates && dates.end) {
            winEnd = new Date(dates.end);
            winEnd.setDate(winEnd.getDate() + 3);
        }
        Object.keys(woMap).forEach(function (no) {
            if (knownMap && knownMap[no]) return;
            var w = woMap[no] || {};
            if (!w.id) return;
            if (winEnd && w.createdAt && w.createdAt.getTime() > winEnd.getTime()) return;
            candidates.push({ no: no, orderId: w.id, fieldId: w.bsFieldId });
        });
        console.log('[AUDIT-HIST] woMap total', Object.keys(woMap).length,
            '| unmatched candidates', candidates.length,
            '| with grid fieldId', candidates.filter(function (c) { return !!c.fieldId; }).length);
        return fetchStatusHistoryShipDates(candidates, dates, function (d, t) {
            showProgress('Checking Bristow Status history (' + d + '/' + t + ')...');
        });
    }



    // Fetches one page of the Work Orders grid handler. The page's grid reads
    // /Orders/Orders?handler=Orders with OfficeIdList + wCompleted (server-side
    // filters). We clear OfficeIdList so every office's orders come back, keep
    // wCompleted on (report is about completed/shipped orders), and page with
    // skip/take until a short page or total reached (zero-new guard against a
    // handler that ignores paging). Response shape is Kendo page ({ Data, Total }).
    function fetchOrdersPage(paramsPage, basePath) {
        basePath = basePath || '/Orders/Orders';
        return new Promise(function (resolve) {
            try {
                var url = basePath + '?' + paramsPage.toString();
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.timeout = 60000;
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4) return;
                    if (xhr.responseURL && xhr.responseURL.indexOf(basePath) === -1) {
                        resolve({ rows: [], total: null, error: 'redirect' });
                        return;
                    }
                    if (xhr.status !== 200) {
                        resolve({ rows: [], total: null, error: 'status-' + xhr.status });
                        return;
                    }
                    try {
                        var body = JSON.parse(xhr.responseText);
                        if (Array.isArray(body)) {
                            resolve({ rows: body, total: null, error: null });
                        } else if (body && Array.isArray(body.Data)) {
                            resolve({
                                rows: body.Data,
                                total: (typeof body.Total === 'number') ? body.Total : null,
                                error: null
                            });
                        } else {
                            resolve({ rows: [], total: null, error: 'shape' });
                        }
                    } catch (e) {
                        resolve({ rows: [], total: null, error: 'parse' });
                    }
                };
                xhr.onerror = function () { resolve({ rows: [], total: null, error: 'network' }); };
                xhr.ontimeout = function () { resolve({ rows: [], total: null, error: 'timeout' }); };
                xhr.send();
            } catch (e) {
                resolve({ rows: [], total: null, error: 'exception' });
            }
        });
    }

    // Bulk-fetches ALL Work Orders (no date filter) via the grid handler so the
    // report is page-independent: it runs from ANY page without navigating to
    // /Orders/Orders. Returns a Promise resolving to a map of orderNo ->
    // { id, rep, customer, component, serialNo, officeRaw, createdAt }. Pagination
    // mirrors fetchOrdersPage (skip/take until a short page or total reached;
    // zero-new guard against a handler that ignores paging).
    function fetchOrdersGridData() {
        var WO_PAGE_SIZE = 25;
        var base = {
            handler: 'Orders',
            OfficeIdList: '',
            wCompleted: 'true',
            pageSize: WO_PAGE_SIZE,
            page: 1
        };
        var collected = [];
        var page = 1;
        var totalCount = null;
        var maxPages = 100;
        var seenIds = {};
        function step() {
            var params = new URLSearchParams(base);
            params.set('page', String(page));
            params.set('skip', String((page - 1) * WO_PAGE_SIZE));
            params.set('take', String(WO_PAGE_SIZE));
            return fetchOrdersPage(params).then(function (res) {
                if (res.error) return { rows: [], error: res.error };
                if (typeof res.total === 'number' && res.total !== null) totalCount = res.total;
                var newIds = 0;
                res.rows.forEach(function (r) {
                    var id = r.Id || '';
                    if (id && !seenIds[id]) { seenIds[id] = true; newIds++; }
                });
                collected = collected.concat(res.rows);
                var haveAll = false;
                if (res.rows.length < WO_PAGE_SIZE) {
                    haveAll = true;
                } else if (totalCount !== null && totalCount > 0) {
                    haveAll = collected.length >= totalCount;
                }
                if (!haveAll && newIds > 0 && page < maxPages) {
                    page++;
                    return step();
                }
                return { rows: collected, error: null };
            });
        }
return step();
    }

    // Fetches ALL Purchase Orders via /Orders/PoList?handler=POs&OfficeIdList=<guid>
    // (remote — runs from any page). The handler returns a plain JSON array with
    // no paging, and filters server-side by a single office, so we request each
    // office separately and merge (de-duplicated by Id). Any failed office fails
    // the whole fetch rather than silently producing an incomplete report.
    function fetchPurchaseOrdersGridData() {
        var offices = getOfficeOptions();
        return Promise.all(offices.map(function (o) {
            var params = new URLSearchParams({ handler: 'POs', OfficeIdList: String(o.value) });
            return fetchOrdersPage(params, '/Orders/PoList');
        })).then(function (results) {
            var seen = {};
            var collected = [];
            for (var i = 0; i < results.length; i++) {
                var res = results[i];
                if (res.error) return { rows: [], error: res.error + ' (office ' + offices[i].text + ')' };
                for (var j = 0; j < res.rows.length; j++) {
                    var r = res.rows[j];
                    var id = r && r.Id;
                    if (id && !seen[id]) { seen[id] = true; collected.push(r); }
                }
            }
            console.log('[AUDIT] PO fetch: ' + collected.length + ' rows from ' + offices.length + ' office(s)');
            return { rows: collected, error: null };
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  REPORT DEFINITIONS
    // ══════════════════════════════════════════════════════════════════════════

    var REPORTS = {
        workOrders: {
            label: 'Work Orders',
            group: 'Orders',
            page: '/Orders/Orders',
            gridId: 'grid',
            wired: true,
            remote: true
        },
        warranty: {
            label: 'Warranty',
            group: 'Orders',
            page: '/Orders/Orders',
            gridId: 'grid',
            wired: true,
            remote: true
        },
        subcontract: {
            label: 'Subcontracts',
            group: 'Orders',
            page: '/Orders/Orders',
            gridId: 'grid',
            wired: true,
            remote: true
        },
        purchaseOrders: {
            label: 'Purchase Orders',
            group: 'Purchase Orders',
            page: '/Orders/PoList',
            gridId: 'grid',
            wired: true,
            remote: true
        },
        timeSensitiveLib: {
            label: 'Time-Sensitive Library',
            group: 'Library',
            page: '/Catalog/Documentations',
            gridId: 'grid',
            wired: true
        },
        manualUsage: {
            label: 'Manual Usage',
            group: 'Library',
            page: '/Orders/Orders',
            gridId: 'grid',
            wired: true,
            remote: true
        },
        manualInhouse: {
            label: 'Manual Inhouse',
            group: 'Library',
            page: '/Catalog/Documentations',
            gridId: 'grid',
            wired: true,
            applyDateRangeHelp: 'Restrict to work orders created within the date range above. Leave unchecked to scan ALL YEG/BRI work orders.'
        },
        gidep: {
            label: 'GIDEP',
            group: 'Library',
            page: '/Catalog/Documentations',
            gridId: 'grid',
            wired: true,
            applyDateRangeHelp: 'Restrict to work orders created within the date range above. Leave unchecked to scan ALL YEG/BRI work orders.'
        },
        inventoryInStock: {
            label: 'Inventory (In Stock)',
            group: 'Inventory',
            page: '/Inventory',
            gridId: 'partGrid',
            wired: true
        },
        inventoryAll: {
            label: 'Inventory (All)',
            group: 'Inventory',
            page: '/Inventory',
            gridId: 'partGrid',
            wired: true
        },
        toolsAll: {
            label: 'Tools (All)',
            group: 'Tools',
            page: '/Catalog/AeroTools',
            gridId: 'grid',
            wired: true
        }
    };

    // Original category chips used by the shop (legacy PAR included).
    var CATEGORIES = ['AAC', 'CAP', 'ELC', 'GYR', 'GAC', 'PAR'];
    // Pseudo-category: units with a MISSING cost center OR a code that doesn't
    // match any real cost center (typo). Selected alone, the report shows ONLY
    // those units; the units themselves always appear regardless of this chip.
    var CATEGORY_MISSING = '__MISSING__';
    // Real cost-center codes (from bristow-costcenters-2026-08-28.json, plus the
    // legacy PAR chip code). Used to classify a cost center as "typed in wrong",
    // i.e. a code that isn't in this set.
    var VALID_COST_CENTERS = ['AAC', 'AVI', 'CAP', 'CARP', 'ELA', 'ELC', 'EST', 'GAC', 'GAQC', 'GAV', 'GRY', 'GYR', 'PT', 'PTE', 'PAR'];

    // Offices from the page's #officeSelect multiselect (Text/Value pairs). When
    // the page is loaded we prefer its live dataSource so newly added offices
    // show up; otherwise fall back to this static snapshot. Default selection =
    // Bristow YEG Base ("OC-YEG"). Filtering happens server-side by setting the
    // page's #officeSelect then searching (gridFilterData() sends OfficeIdList),
    // exactly like the WIP button does.
    var OFFICES = [
        { text: 'Bristow YEG Base', value: '59833dd9-ed10-4e71-6208-08daa3f123de' },
        { text: 'Bristow YLW Base', value: '70902da8-fbb4-4766-59f8-08dced71f01f' },
        { text: 'VSI YYC Base', value: '67277f28-6f59-4f78-2e43-08dd4c9799f5' }
    ];

    function getOfficeOptions() {
        try {
            if ($p) {
                var ms = $p('#officeSelect').data('kendoMultiSelect');
                if (ms && ms.dataSource) {
                    var items = ms.dataSource.data();
                    if (items && items.length) {
                        return items.map(function (it) {
                            return { text: it.Text || it.text || String(it.Value || it.value), value: it.Value || it.value };
                        });
                    }
                }
            }
        } catch (e) {}
        return OFFICES;
    }

    // PO Status / Order Type code->text resolution. The PO clone records carry only
    // the flat numeric codes (Status="3", OrderType="0"); the page's own grid filter
    // dropdowns hold the authoritative code->text list. Prefer reading those at
    // runtime (mirrors getOfficeOptions), falling back to the confirmed defaults.
    var PO_STATUS_OPTIONS = [
        { value: 0, text: 'Open' },
        { value: 1, text: 'Submitted' },
        { value: 2, text: 'Partial' },
        { value: 3, text: 'Complete' }
    ];
    var PO_ORDER_TYPE_OPTIONS = [
        { value: 0, text: 'Customer' },
        { value: 1, text: 'Stock' },
        { value: 2, text: 'Transfer' },
        { value: 3, text: 'Return' }
    ];

    // Reads a Kendo filter dropdownlist's data-source JSON (array of {text,value})
    // from the page when present. Returns an array of {value,text} objects.
    function readFilterOptions(role) {
        try {
            if (!$p) return null;
            var finds = [];
            var selects = $p('select[data-role="dropdownlist"]');
            for (var i = 0; i < selects.length; i++) {
                var sel = $p(selects[i]);
                var src = sel.attr('data-source');
                if (!src || !/\[\{/.test(src)) continue;
                try {
                    var json = src.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
                    var data = JSON.parse(json);
                    if (data && data.length) {
                        finds.push(data.map(function (d) {
                            return { value: d.value, text: d.text };
                        }));
                    }
                } catch (e) {}
            }
            if (!finds.length) return null;
            // Return the list whose texts best match the requested role.
            var scored = finds.map(function (list, idx) {
                var score = 0;
                var joined = list.map(function (o) { return o.text; }).join('|').toLowerCase();
                if (role === 'status' && /open|submit|partial|complete/.test(joined)) score += 2;
                if (role === 'ordertype' && /customer|supplier/.test(joined)) score += 2;
                return { list: list, score: score, idx: idx };
            });
            scored.sort(function (a, b) { return b.score - a.score; });
            if (scored[0].score > 0 && scored[0].list.length) return scored[0].list;
            // Fall back to the largest option list (likely the status list) for status role.
            if (role === 'status') {
                scored.sort(function (a, b) { return b.list.length - a.list.length; });
                if (scored[0].list.length) return scored[0].list;
            }
        } catch (e) {}
        return null;
    }

    function getPOStatusOptions() {
        var live = readFilterOptions('status');
        return (live && live.length) ? live : PO_STATUS_OPTIONS;
    }

    function getPOOrderTypeOptions() {
        var live = readFilterOptions('ordertype');
        return (live && live.length) ? live : PO_ORDER_TYPE_OPTIONS;
    }

    function poOptionText(value, options) {
        var s = value == null ? '' : String(value);
        if (s === '') return '';
        for (var i = 0; i < options.length; i++) {
            if (String(options[i].value) === s) return String(options[i].text);
        }
        return s;
    }

    // Map an order-number prefix's 3-letter office code to its display Name and
    // office GUID. Legacy "OC-BRI" treated as YEG so old BRI orders still belong
    // to Bristow YEG Base.
    var OFFICE_SEG_TEXT = {
        YEG: 'Bristow YEG Base',
        BRI: 'Bristow YEG Base',
        YLW: 'Bristow YLW Base',
        YYC: 'VSI YYC Base'
    };
    var OFFICE_SEG_NAME = {
        YEG: OFFICES[0].value,
        BRI: OFFICES[0].value,
        YLW: OFFICES[1].value,
        YYC: OFFICES[2].value
    };

    // Extracts the office code segment from an order number like "OC-YEG-123456"
    // (or legacy "OC-BRI-...").
    function officeCodeFromOrder(orderNo) {
        var m = /^OC-([A-Z]{2,5})-/.exec(String(orderNo || '').trim().toUpperCase());
        return m ? m[1] : '';
    }

    function getSelectedOffices() {
        var modal = document.getElementById(MODAL_ID);
        if (modal) {
            var offices = [];
            modal.querySelectorAll('.office-chip.active').forEach(function (el) {
                offices.push(el.dataset.value);
            });
            return offices;
        }
        // Modal closed (same-page run or cross-page dispatch) — fall back to the
        // offices captured at click time.
        if (pendingFilters && pendingFilters.offices) return pendingFilters.offices;
        // Default to Bristow YEG Base only (user's preferred default office filter).
        return [OFFICES[0].value];
    }

    // Set the page's #officeSelect multiselect to the picked offices; the widget
    // fires change -> searchGrid, so the server's gridFilterData() sends only
    // OfficeIdList for the selected offices.
    function setPageOffices(offices) {
        try {
            if (!$p) return;
            var ms = $p('#officeSelect').data('kendoMultiSelect');
            if (!ms) return;
            var vals = (offices && offices.length) ? offices : [OFFICES[0].value];
            ms.value(vals);
        } catch (e) {
            console.error('[AUDIT] setPageOffices failed', e);
        }
    }

    // Cost Center values in the wild are inconsistent: some orders just have
    // the code ("PAR"), others have "Word (CODE)" ("Gyro (GYR)"). Pull the
    // code out of either shape so filtering matches regardless of how it was typed.
    function extractCategoryCode(costCenter) {
        if (!costCenter) return '';
        var m = /\(([A-Z]{2,5})\)\s*$/.exec(costCenter.trim());
        if (m) return m[1].toUpperCase();
        return costCenter.trim().toUpperCase();
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  CSS
    // ═════════════════════════════════════════════════════════════════════════

    var CSS = `
#${BUTTON_ID}-float {
            position: fixed;
            top: 12px;
            right: 20px;
            z-index: 2147483647;
            background: #378ADD;
            color: #fff;
            border: none;
            padding: 10px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-family: 'Roboto', sans-serif;
            font-size: 13px;
            font-weight: 600;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            transition: background 0.2s;
        }
        #${BUTTON_ID}-float:hover { background: #2a6bb5; }

        #${MODAL_ID} {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.45);
            z-index: 9999999;
            display: flex;
            align-items: flex-start;
            justify-content: center;
            padding-top: 5vh;
            overflow-y: auto;
        }
        #${MODAL_ID} .audit-box {
            background: #fff;
            color: #333;
            border-radius: 6px;
            padding: 20px 24px;
            width: 800px;
            max-width: 94vw;
            box-shadow: 0 6px 24px rgba(0,0,0,0.3);
            font-family: 'Roboto', sans-serif;
            margin-bottom: 40px;
            position: relative;
        }
        #${MODAL_ID} .audit-box h2 {
            margin: 0 0 4px;
            font-size: 22px;
            color: #333;
        }
        #${MODAL_ID} .audit-box .subtitle {
            font-size: 12px;
            color: #999;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid #eee;
        }

        #${MODAL_ID} .filter-row {
            display: flex;
            gap: 16px;
            margin-bottom: 16px;
            flex-wrap: wrap;
            align-items: flex-end;
        }
        #${MODAL_ID} .filter-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        #${MODAL_ID} .filter-group label {
            font-size: 11px;
            color: #666;
            text-transform: uppercase;
            font-weight: 600;
        }
        #${MODAL_ID} .filter-group input[type="text"],
        #${MODAL_ID} .filter-group input[type="date"] {
            background: #fff;
            border: 1px solid #ccc;
            color: #333;
            padding: 6px 10px;
            border-radius: 4px;
            font-size: 13px;
            font-family: 'Roboto Mono', monospace;
            width: 160px;
            height: 34px;
            box-sizing: border-box;
        }
        #${MODAL_ID} .filter-group input:focus {
            outline: none;
            border-color: #378ADD;
            box-shadow: 0 0 0 2px rgba(55,138,221,0.15);
        }
        /* Kendo date pickers wrap the input with a calendar button — give the
           widget room so the button isn't clipped off the right edge. */
        #${MODAL_ID} .filter-group .k-datepicker {
            width: 200px;
        }
        #${MODAL_ID} .filter-group .k-datepicker .k-input,
        #${MODAL_ID} .filter-group .k-datepicker .k-picker-wrap,
        #${MODAL_ID} .filter-group .k-datepicker .k-dateinput-wrap {
            width: 100%;
            box-sizing: border-box;
        }

        #${MODAL_ID} .cat-row {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            margin-bottom: 16px;
            align-items: center;
        }
        #${MODAL_ID} .cat-label {
            font-size: 11px;
            color: #666;
            text-transform: uppercase;
            font-weight: 600;
            margin-right: 4px;
        }
        #${MODAL_ID} .cat-chip, #${MODAL_ID} .office-chip, #${MODAL_ID} .cg-chip, #${MODAL_ID} .rep-chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: #f5f5f5;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 4px 10px;
            font-size: 12px;
            font-weight: 600;
            color: #555;
            cursor: pointer;
            transition: all 0.15s;
            user-select: none;
        }
        #${MODAL_ID} .cat-chip:hover, #${MODAL_ID} .office-chip:hover, #${MODAL_ID} .cg-chip:hover, #${MODAL_ID} .rep-chip:hover { border-color: #378ADD; color: #378ADD; }
        #${MODAL_ID} .cat-chip.active, #${MODAL_ID} .office-chip.active, #${MODAL_ID} .cg-chip.active, #${MODAL_ID} .rep-chip.active {
            background: #378ADD;
            border-color: #378ADD;
            color: #fff;
        }
        #${MODAL_ID} .cat-chip input,
        #${MODAL_ID} .office-chip input,
        #${MODAL_ID} .cg-chip input,
        #${MODAL_ID} .rep-chip input { margin: 0; accent-color: #378ADD; cursor: pointer; }

        #${MODAL_ID} .cat-chip.missing-chip { border-style: dashed; }
        #${MODAL_ID} .cat-chip.missing-chip.active { background: #e67e22; border-color: #e67e22; color: #fff; }

        #${MODAL_ID} .report-grid {
            display: flex;
            gap: 12px;
            margin-bottom: 16px;
            align-items: flex-start;
        }
        #${MODAL_ID} .report-col {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        #${MODAL_ID} .report-group {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 4px;
            padding: 12px;
        }
        #${MODAL_ID} .report-group h4 {
            margin: 0 0 8px;
            font-size: 12px;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 700;
        }
        #${MODAL_ID} .report-btn {
            display: block;
            width: 100%;
            background: #fff;
            color: #333;
            border: 1px solid #ddd;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 13px;
            font-family: 'Roboto', sans-serif;
            cursor: pointer;
            text-align: left;
            margin-bottom: 6px;
            transition: all 0.15s;
            position: relative;
        }
        #${MODAL_ID} .report-btn:last-child { margin-bottom: 0; }
        #${MODAL_ID} .report-btn:hover { background: #e9ecef; border-color: #378ADD; }
        #${MODAL_ID} .report-btn.wired { border-left: 3px solid #28a745; }
        #${MODAL_ID} .report-btn:not(.wired) { border-left: 3px solid #ccc; opacity: 0.65; }
        #${MODAL_ID} .report-btn .tag {
            font-size: 9px;
            padding: 1px 6px;
            border-radius: 3px;
            margin-left: 8px;
            font-weight: 700;
            text-transform: uppercase;
        }
        #${MODAL_ID} .report-btn .tag-wip { background: #e9ecef; color: #888; }

        #${MODAL_ID} .audit-actions {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            padding-top: 12px;
            border-top: 1px solid #eee;
        }
        #${MODAL_ID} .audit-actions button {
            border: none;
            padding: 8px 18px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            font-family: 'Roboto', sans-serif;
            transition: opacity 0.2s;
        }
        #${MODAL_ID} .audit-actions button:hover { opacity: 0.85; }
        #${MODAL_ID} .btn-close { background: #6c757d; color: #fff; }

        #${TOAST_ID} {
            position: fixed;
            bottom: 80px;
            right: 20px;
            z-index: 9999999;
            background: #fff;
            color: #333;
            padding: 12px 16px;
            border-radius: 4px;
            font-size: 13px;
            font-family: 'Roboto', sans-serif;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            opacity: 0;
            transform: translateY(10px);
            transition: all 0.3s;
            pointer-events: none;
            max-width: 360px;
            border: 1px solid #ddd;
        }
        #${TOAST_ID}.show {
            opacity: 1;
            transform: translateY(0);
        }
        #${TOAST_ID}.toast-warn { border-left: 4px solid #ffc107; }
        #${TOAST_ID}.toast-info { border-left: 4px solid #17a2b8; }
        #${TOAST_ID}.toast-ok { border-left: 4px solid #28a745; }

        #${SCRIPT_ID}-progress {
            position: fixed;
            top: 60px;
            right: 16px;
            z-index: 9999999;
            background: #fff;
            color: #333;
            padding: 12px 16px;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            font-size: 13px;
            font-family: 'Roboto', sans-serif;
            border: 1px solid #ddd;
            display: none;
        }
        #${SCRIPT_ID}-progress .spinner {
            display: inline-block;
            width: 14px;
            height: 14px;
            border: 2px solid #ddd;
            border-top-color: #378ADD;
            border-radius: 50%;
            animation: audit-spin 0.7s linear infinite;
            margin-right: 8px;
            vertical-align: middle;
        }
        @keyframes audit-spin {
            to { transform: rotate(360deg); }
        }
        #${MODAL_ID} .auditor-row {
            margin: 10px 0 6px;
            padding: 10px 12px;
            border: 1px solid #e3e3e3;
            border-radius: 4px;
            background: #fbfbfb;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
        }
        #${MODAL_ID} .auditor-row .auditor-label {
            font-size: 13px;
            font-weight: 600;
            color: #333;
        }
        #${MODAL_ID} .auditor-row .auditor-desc {
            font-size: 11px;
            color: #888;
            margin-top: 2px;
        }
        #${MODAL_ID} .auditor-toggle {
            background: #27ae60;
            color: #fff;
            border: none;
            padding: 7px 14px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
        }
        #${MODAL_ID} .auditor-toggle.off { background: #2c3e50; }
        #${MODAL_ID} .auditor-toggle:hover { opacity: 0.85; }
        #${MODAL_ID} .auditor-state {
            font-size: 11px;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 10px;
            letter-spacing: 0.5px;
            white-space: nowrap;
        }
        #${MODAL_ID} .auditor-state.on { background: #d4edda; color: #155724; }
        #${MODAL_ID} .auditor-state.off { background: #e9ecef; color: #666; }

        #${MODAL_ID} details > summary::-webkit-details-marker { display: none; }
    `;

    // ═════════════════════════════════════════════════════════════════════════
    //  INJECT STYLES
    // ═════════════════════════════════════════════════════════════════════════

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        if (GM_addStyle) {
            GM_addStyle(CSS);
        } else {
            var s = document.createElement('style');
            s.id = STYLE_ID;
            s.textContent = CSS;
            document.head.appendChild(s);
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  BUTTON
    // ═════════════════════════════════════════════════════════════════════════

    function injectButton() {
        if (document.getElementById(BUTTON_ID) || document.getElementById(BUTTON_ID + '-float')) return;

        // Try to inject the AUDIT link right next to the Search icon in the
        // top toolbar so it stays in-flow (zoom-safe, no fixed positioning).
        var searchLink = document.querySelector('a[href="/Search/Index"]');
        if (searchLink && searchLink.parentNode && searchLink.parentNode.parentNode) {
            var li = document.createElement('li');
            li.id = BUTTON_ID;
            var a = document.createElement('a');
            a.href = '#';
            a.textContent = 'AUDIT';
            a.title = 'Open Audit Console';
            a.style.cssText = 'font-weight:600;color:#378ADD;cursor:pointer;';
            a.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                openModal();
            });
            li.appendChild(a);
            // Insert the <li> as a sibling of the search icon's <li> (same row),
            // not as a child inside it (which would stack vertically).
            searchLink.parentNode.parentNode.insertBefore(li, searchLink.parentNode.nextSibling);
            return;
        }

        // Fallback: floating button (fixed, in case the toolbar isn't found)
        var fallback = document.createElement('button');
        fallback.id = BUTTON_ID + '-float';
        fallback.textContent = 'AUDIT';
        fallback.title = 'Open Audit Console';
        fallback.addEventListener('click', openModal);
        document.body.appendChild(fallback);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  TOAST
    // ═════════════════════════════════════════════════════════════════════════

    var toastTimer = null;

    function showToast(msg, type) {
        type = type || 'warn';
        var el = document.getElementById(TOAST_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = TOAST_ID;
            document.body.appendChild(el);
        }
        clearTimeout(toastTimer);
        el.className = '';
        el.textContent = msg;
        el.classList.add('toast-' + type);
        requestAnimationFrame(function () {
            el.classList.add('show');
        });
        toastTimer = setTimeout(function () {
            el.classList.remove('show');
        }, 3500);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  PROGRESS
    // ═════════════════════════════════════════════════════════════════════════

    function showProgress(msg) {
        var el = document.getElementById(SCRIPT_ID + '-progress');
        if (!el) {
            el = document.createElement('div');
            el.id = SCRIPT_ID + '-progress';
            document.body.appendChild(el);
        }
        el.innerHTML = '<span class="spinner"></span> ' + msg;
        el.style.display = 'block';
    }

    function hideProgress() {
        var el = document.getElementById(SCRIPT_ID + '-progress');
        if (el) el.style.display = 'none';
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  DATE HELPERS
    // ═════════════════════════════════════════════════════════════════════════

    function formatDateInput(str) {
        var s = String(str || '').trim();
        var m;
        if (m = /^(\d{1,2})[-\/](\w{3})[-\/](\d{4})$/.exec(s)) {
            var mo = MONTHS_MAP[m[2].toUpperCase()];
            if (mo !== undefined) {
                return new Date(parseInt(m[3], 10), mo, parseInt(m[1], 10));
            }
        }
        if (m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)) {
            return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        }
        return null;
    }

    function toIsoDate(d) {
        if (!d || isNaN(d.getTime())) return '';
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function toDisplayDate(d) {
        if (!d || isNaN(d.getTime())) return '';
        return String(d.getDate()).padStart(2, '0') + '-' + MONTHS[d.getMonth()] + '-' + d.getFullYear();
    }

    // Order cell for panel rows: hyperlink to the order Edit page when the
    // row carries an orderId, plain text otherwise.
    function orderLinkHtml(order, orderId) {
        if (!orderId) return String(order || '');
        return '<a href="' + location.origin + '/Orders/Orders/Edit?id=' + encodeURIComponent(orderId)
            + '" target="_blank" rel="noopener" style="color:#1a5fb4;text-decoration:underline;">'
            + String(order || '') + '</a>';
    }

    // Renders an order's Uploads as HTML links (ViewFile). Multiple documents
    // render one per line. Returns '' when there are none.
    function docLinksHtml(docs) {
        var list = Array.isArray(docs) ? docs : [];
        var parts = [];
        for (var i = 0; i < list.length; i++) {
            var d = list[i] || {};
            if (!d.documentId) continue;
            parts.push('<a href="' + location.origin + '/Orders/Orders/Edit?handler=ViewFile&documentId='
                + encodeURIComponent(d.documentId)
                + '" target="_blank" rel="noopener" style="color:#1c5d99;text-decoration:underline;">'
                + String(d.name || 'Document') + '</a>');
        }
        return parts.join('<br>');
    }

    // Plain-text names of an order's Uploads ('; '-separated) for Excel/printout.
    function docNames(docs) {
        var list = Array.isArray(docs) ? docs : [];
        var parts = [];
        for (var i = 0; i < list.length; i++) {
            var d = list[i] || {};
            if (d.documentId) parts.push(String(d.name || 'Document'));
        }
        return parts.join('; ');
    }

    // ── PO "Remove Rows" UI: red-X column, reason dialog, undo bar, manager ──
    function poEsc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function poRuleDescribe(rule) {
        if (!rule) return '';
        if (rule.kind === 'blank-part') return 'Part is blank';
        if (rule.kind === 'part-contains') return 'Part contains "' + rule.text + '"' + (rule.word ? ' (whole word)' : '');
        if (rule.kind === 'po') return 'This PO only: ' + (rule.poNumber || rule.poId || '');
        return '';
    }

    function poCountMatches(rule, list) {
        var n = 0;
        for (var i = 0; i < list.length; i++) { if (poRuleMatches(rule, list[i])) n++; }
        return n;
    }

    function poPanelScrollTop() {
        var panel = document.getElementById(SCRIPT_ID + '-report-panel');
        var t = panel ? panel.querySelector('table') : null;
        return t && t.parentNode ? t.parentNode.scrollTop : 0;
    }

    function showPOUndoBar(msg, onUndo) {
        var id = SCRIPT_ID + '-po-undo-bar';
        var old = document.getElementById(id);
        if (old && old.parentNode) old.parentNode.removeChild(old);
        var bar = document.createElement('div');
        bar.id = id;
        bar.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#222;color:#fff;padding:10px 14px;border-radius:6px;font:13px Arial,sans-serif;display:flex;gap:14px;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
        var span = document.createElement('span');
        span.textContent = msg;
        var btn = document.createElement('button');
        btn.textContent = 'Undo';
        btn.style.cssText = 'background:#f1c40f;color:#222;border:none;padding:5px 12px;border-radius:4px;cursor:pointer;font-weight:700;font-size:12px;';
        var timer = setTimeout(function () { if (bar.parentNode) bar.parentNode.removeChild(bar); }, 15000);
        btn.onclick = function () {
            clearTimeout(timer);
            if (bar.parentNode) bar.parentNode.removeChild(bar);
            onUndo();
        };
        bar.appendChild(span);
        bar.appendChild(btn);
        document.body.appendChild(bar);
    }

    // Reason dialog for the red X on one report row. ctx: { pool, rows, hidden, rerender }.
    function showPORemoveDialog(ctx, idx) {
        var r = ctx.rows[idx];
        if (!r) return;
        var DLG = SCRIPT_ID + '-po-rm-dlg';
        var oldDlg = document.getElementById(DLG);
        if (oldDlg && oldDlg.parentNode) oldDlg.parentNode.removeChild(oldDlg);

        var partTxt = String(r.part || '').trim();
        var testSetRule = { kind: 'part-contains', text: 'test set', word: true, reason: 'Test set' };
        var defKind = !partTxt ? 'blank' : (poRuleMatches(testSetRule, r) ? 'testset' : 'contains');

        var ov = document.createElement('div');
        ov.id = DLG;
        ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;';
        var inpStyle = 'width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ccc;border-radius:3px;font-size:13px;';
        ov.innerHTML = '<div style="background:#fff;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,0.4);width:480px;max-width:94%;padding:16px 18px;font-size:13px;color:#222;">'
            + '<div style="font-size:15px;font-weight:600;margin-bottom:8px;">Remove row from report</div>'
            + '<div style="background:#f5f8fc;border:1px solid #dde5ee;border-radius:4px;padding:8px 10px;margin-bottom:10px;line-height:1.5;">'
            + '<b>' + poEsc(r.poNumber) + '</b> &nbsp;(' + poEsc(r.orderNumber) + ')<br>Part: '
            + (partTxt ? poEsc(partTxt) : '<i style="color:#888;">(blank)</i>') + '</div>'
            + '<label style="display:block;font-weight:600;margin-bottom:3px;">Reason</label>'
            + '<select id="' + DLG + '-sel" style="' + inpStyle + 'margin-bottom:8px;">'
            + '<option value="blank">Blank part &mdash; hides every PO with an empty Part</option>'
            + '<option value="testset">Test set &mdash; hides every PO whose Part says "test set"</option>'
            + '<option value="contains">Part contains&hellip; &mdash; hides every PO matching text you enter</option>'
            + '<option value="other">Other &mdash; hides only this PO</option>'
            + '</select>'
            + '<div id="' + DLG + '-wc" style="margin-bottom:8px;"><label style="display:block;font-weight:600;margin-bottom:3px;">Part contains (not case-sensitive)</label>'
            + '<input id="' + DLG + '-ic" type="text" style="' + inpStyle + '"></div>'
            + '<div id="' + DLG + '-wo" style="margin-bottom:8px;"><label style="display:block;font-weight:600;margin-bottom:3px;">Reason (type it in)</label>'
            + '<input id="' + DLG + '-io" type="text" placeholder="e.g. Duplicate of another PO" style="' + inpStyle + '"></div>'
            + '<div id="' + DLG + '-prev" style="color:#444;margin-bottom:4px;min-height:18px;"></div>'
            + '<div id="' + DLG + '-err" style="color:#c0392b;margin-bottom:8px;min-height:18px;"></div>'
            + '<div style="display:flex;justify-content:flex-end;gap:8px;">'
            + '<button id="' + DLG + '-cancel" style="background:#eee;color:#333;border:1px solid #ccc;padding:7px 16px;border-radius:4px;cursor:pointer;font-size:13px;">Cancel</button>'
            + '<button id="' + DLG + '-ok" style="background:#c0392b;color:#fff;border:none;padding:7px 18px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;">Remove</button>'
            + '</div></div>';
        document.body.appendChild(ov);

        var sel = document.getElementById(DLG + '-sel');
        var wc = document.getElementById(DLG + '-wc');
        var wo = document.getElementById(DLG + '-wo');
        var ic = document.getElementById(DLG + '-ic');
        var io = document.getElementById(DLG + '-io');
        var prev = document.getElementById(DLG + '-prev');
        var err = document.getElementById(DLG + '-err');
        var okBtn = document.getElementById(DLG + '-ok');
        sel.value = defKind;
        ic.value = partTxt;

        function closeDlg() { if (ov.parentNode) ov.parentNode.removeChild(ov); }

        function evaluate() {
            var kind = sel.value;
            var rule = null;
            if (kind === 'blank') {
                rule = { kind: 'blank-part', reason: 'Blank part' };
            } else if (kind === 'testset') {
                rule = { kind: 'part-contains', text: 'test set', word: true, reason: 'Test set' };
            } else if (kind === 'contains') {
                var t = String(ic.value || '').trim();
                if (t.length < 2) return { error: 'Enter at least 2 characters of Part text.' };
                rule = { kind: 'part-contains', text: t, reason: 'Part contains "' + t + '"' };
            } else {
                var why = String(io.value || '').trim();
                if (!why) return { error: 'Type a reason for removing this PO.' };
                rule = { kind: 'po', poId: r.id, poNumber: r.poNumber, reason: why };
            }
            if (!poRuleMatches(rule, r)) {
                return { error: 'This row\'s Part does not match that reason. Pick another reason or use "Part contains\u2026".' };
            }
            return { rule: rule, count: poCountMatches(rule, ctx.pool) };
        }

        function refresh() {
            var kind = sel.value;
            wc.style.display = kind === 'contains' ? '' : 'none';
            wo.style.display = kind === 'other' ? '' : 'none';
            var ev = evaluate();
            if (ev.error) {
                prev.textContent = '';
                err.textContent = ev.error;
                okBtn.disabled = true;
                okBtn.style.opacity = '0.5';
            } else {
                err.textContent = '';
                prev.textContent = 'This will hide ' + ev.count + ' PO' + (ev.count === 1 ? '' : 's') + ' in the current report, and every future run.';
                okBtn.disabled = false;
                okBtn.style.opacity = '1';
            }
        }

        function confirmRemove() {
            var ev = evaluate();
            if (ev.error) return;
            var rule = ev.rule;
            rule.id = 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            rule.addedAt = new Date().toISOString();
            var list = getPORowExclusions();
            var dup = list.some(function (q) {
                return q.kind === rule.kind && poNormText(q.text) === poNormText(rule.text) && (q.poId || '') === (rule.poId || '');
            });
            if (!dup) { list.push(rule); savePORowExclusions(list); }
            closeDlg();
            poRestoreScrollTop = poPanelScrollTop();
            ctx.rerender();
            showPOUndoBar(ev.count + ' PO' + (ev.count === 1 ? '' : 's') + ' hidden \u2014 ' + rule.reason, function () {
                savePORowExclusions(getPORowExclusions().filter(function (q) { return q.id !== rule.id; }));
                poRestoreScrollTop = poPanelScrollTop();
                ctx.rerender();
            });
        }

        sel.onchange = refresh;
        ic.oninput = refresh;
        io.oninput = refresh;
        okBtn.onclick = confirmRemove;
        document.getElementById(DLG + '-cancel').onclick = closeDlg;
        ov.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeDlg();
            else if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') { e.preventDefault(); confirmRemove(); }
        });
        refresh();
        (defKind === 'contains' ? ic : sel).focus();
    }

    // Drawer listing every saved removal rule with its reason, how many POs it
    // hides right now, and a Restore button. Persists across re-renders via
    // poRemovedMgrOpen.
    function togglePORemovedManager(ctx, panel, forceOpen) {
        if (!panel) return;
        var host = panel.querySelector('[data-audit-rowrm-mgr]');
        if (host) {
            host.parentNode.removeChild(host);
            if (!forceOpen) { poRemovedMgrOpen = false; return; }
        }
        poRemovedMgrOpen = true;
        var rules = getPORowExclusions();
        var mgr = document.createElement('div');
        mgr.setAttribute('data-audit-rowrm-mgr', '1');
        mgr.style.cssText = 'padding:10px 16px;border-bottom:1px solid #ddd;background:#fbfcfd;font-family:Arial,sans-serif;font-size:12px;';
        var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><div style="font-weight:600;color:#222;flex:1;">Removed Rows &mdash; saved removals (applied to every PO report run)</div>'
            + (rules.length ? '<button data-rowrm-all style="background:#eee;color:#333;border:1px solid #ccc;padding:4px 12px;border-radius:3px;cursor:pointer;font-size:12px;">Restore all</button>' : '')
            + '</div>';
        if (!rules.length) {
            html += '<div style="color:#888;padding:4px 2px;">Nothing removed yet. Turn on <b>Remove Rows</b>, then click a red &#10005; next to a row.</div>';
        } else {
            html += '<div style="max-height:220px;overflow-y:auto;border:1px solid #e2e2e2;border-radius:3px;background:#fff;"><table style="border-collapse:collapse;width:100%;font-size:12px;">'
                + '<tr style="background:#f0f3f7;text-align:left;"><th style="padding:5px 8px;">Reason</th><th style="padding:5px 8px;">Applies to</th><th style="padding:5px 8px;">Hides now</th><th style="padding:5px 8px;">Added</th><th></th></tr>';
            rules.forEach(function (q) {
                var when = q.addedAt ? String(q.addedAt).slice(0, 10) : '';
                html += '<tr style="border-top:1px solid #eee;">'
                    + '<td style="padding:5px 8px;font-weight:600;">' + poEsc(q.reason) + '</td>'
                    + '<td style="padding:5px 8px;">' + poEsc(poRuleDescribe(q)) + '</td>'
                    + '<td style="padding:5px 8px;">' + poCountMatches(q, ctx.pool) + '</td>'
                    + '<td style="padding:5px 8px;color:#777;">' + poEsc(when) + '</td>'
                    + '<td style="padding:5px 8px;text-align:right;"><button data-rowrm-id="' + poEsc(q.id) + '" style="background:#27ae60;color:#fff;border:none;padding:4px 12px;border-radius:3px;cursor:pointer;font-size:12px;">Restore</button></td>'
                    + '</tr>';
            });
            html += '</table></div>';
        }
        mgr.innerHTML = html;

        var tools = panel.querySelector('.audit-panel-tools');
        var anchor = tools && tools.parentNode ? tools.parentNode : panel;
        anchor.parentNode.insertBefore(mgr, anchor.nextSibling);

        mgr.querySelectorAll('[data-rowrm-id]').forEach(function (b) {
            b.onclick = function () {
                var id = b.getAttribute('data-rowrm-id');
                savePORowExclusions(getPORowExclusions().filter(function (q) { return q.id !== id; }));
                poRestoreScrollTop = poPanelScrollTop();
                ctx.rerender();
            };
        });
        var allBtn = mgr.querySelector('[data-rowrm-all]');
        if (allBtn) allBtn.onclick = function () {
            savePORowExclusions([]);
            poRestoreScrollTop = poPanelScrollTop();
            ctx.rerender();
        };
    }

    // Adds the "Remove Rows" toggle + "Removed Rows" manager buttons to the PO
    // report panel and (when the toggle is on) a red X inside each row's first
    // cell. ctx: { pool (rows before removal rules), rows (rows shown), hidden, rerender }.
    function installPORowRemoval(ctx) {
        var panel = document.getElementById(SCRIPT_ID + '-report-panel');
        if (!panel) return;
        var tools = panel.querySelector('.audit-panel-tools');
        var table = panel.querySelector('table');
        var tbody = table ? table.querySelector('tbody') : null;
        if (!tools) return;

        function mk(label, bg) {
            var b = document.createElement('button');
            b.textContent = label;
            b.style.cssText = 'background:' + bg + ';color:#fff;border:none;padding:7px 14px;border-radius:4px;cursor:pointer;font-size:12px;';
            return b;
        }
        var modeBtn = mk('Remove Rows', '#c0392b');
        var listBtn = mk('Removed Rows (' + ctx.hidden + ')', '#7f8c8d');

        function paintMode() {
            modeBtn.textContent = poRemoveModeOn ? 'Remove Rows: ON' : 'Remove Rows';
            modeBtn.style.background = poRemoveModeOn ? '#7b241c' : '#c0392b';
            modeBtn.style.boxShadow = poRemoveModeOn ? 'inset 0 0 0 2px #f1c40f' : 'none';
            if (!tbody) return;
            for (var i = 0; i < tbody.children.length && i < ctx.rows.length; i++) {
                var c0 = tbody.children[i].children[0];
                if (!c0) continue;
                var ex = c0.querySelector('[data-aoc-rm]');
                if (poRemoveModeOn && !ex) {
                    var x = document.createElement('button');
                    x.type = 'button';
                    x.setAttribute('data-aoc-rm', '1');
                    x.textContent = '\u2715';
                    x.title = 'Remove this row from the report';
                    x.style.cssText = 'background:#c0392b;color:#fff;border:none;border-radius:3px;width:20px;height:20px;line-height:18px;padding:0;margin-right:6px;cursor:pointer;font-size:12px;font-weight:700;vertical-align:middle;';
                    (function (rowIdx) {
                        x.onclick = function (ev) { ev.stopPropagation(); showPORemoveDialog(ctx, rowIdx); };
                    })(i);
                    c0.insertBefore(x, c0.firstChild);
                } else if (!poRemoveModeOn && ex) {
                    c0.removeChild(ex);
                }
            }
        }

        modeBtn.onclick = function () { poRemoveModeOn = !poRemoveModeOn; paintMode(); };
        listBtn.onclick = function () { togglePORemovedManager(ctx, panel, false); };

        var vend = document.getElementById(SCRIPT_ID + '-report-panel-vendors');
        var closeBtn = document.getElementById(SCRIPT_ID + '-report-panel-close');
        var before = vend ? vend.nextSibling : closeBtn;
        tools.insertBefore(modeBtn, before || null);
        tools.insertBefore(listBtn, before || null);

        paintMode();
        if (poRemovedMgrOpen) togglePORemovedManager(ctx, panel, true);
        if (poRestoreScrollTop != null && table && table.parentNode) {
            table.parentNode.scrollTop = poRestoreScrollTop;
            poRestoreScrollTop = null;
        }
    }

    // Toggles the PO report panel's "Excluded Vendors" manager drawer. Shows the
    // current exclude list (with per-item remove), an add input, and a clear-all
    // button; every change persists then calls onChanged() so the report re-
    // builds with the new exclusions applied. Panel-local, so it leaves the
    // other reports' panels untouched.
    // vendorStats: optional array of {name, count} for every distinct vendor
    // seen in the current (unfiltered) report, so the checklist below covers
    // both "already excluded" and "currently visible" vendors in one place.
    // Batch workflow: check/uncheck any number of vendors, hit Apply once —
    // no more one-at-a-time removal.
    function toggleVendorManager(panel, onChanged, vendorStats) {
        if (!panel) return;
        var host = panel.querySelector('[data-audit-vendor-mgr]');
        if (host) {
            host.parentNode.removeChild(host);
            return;
        }
        var excludedList = getExcludedVendors();
        var excludedLower = {};
        for (var xi = 0; xi < excludedList.length; xi++) {
            excludedLower[String(excludedList[xi]).trim().toLowerCase()] = true;
        }

        // Union of vendors currently in the report + already-excluded vendors
        // (so a vendor with zero POs in the current view can still be
        // un-excluded), deduped case-insensitively, sorted alphabetically.
        var seen = {};
        var combined = [];
        (vendorStats || []).forEach(function (s) {
            var lower = String(s.name || '').trim().toLowerCase();
            if (!lower || seen[lower]) return;
            seen[lower] = true;
            combined.push({ name: String(s.name).trim(), count: s.count || 0 });
        });
        excludedList.forEach(function (v) {
            var lower = String(v || '').trim().toLowerCase();
            if (!lower || seen[lower]) return;
            seen[lower] = true;
            combined.push({ name: String(v).trim(), count: 0 });
        });
        combined.sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });

        var mgr = document.createElement('div');
        mgr.setAttribute('data-audit-vendor-mgr', '1');
        mgr.style.cssText = 'padding:10px 16px;border-bottom:1px solid #ddd;background:#fbfcfd;font-family:Arial,sans-serif;font-size:12px;';

        var searchId = SCRIPT_ID + '-vendor-search';
        var listId = SCRIPT_ID + '-vendor-list';
        var addId = SCRIPT_ID + '-vendor-add';

        var rowsHtml = '';
        if (combined.length === 0) {
            rowsHtml = '<div style="color:#888;padding:6px 2px;">No vendors found in this report.</div>';
        } else {
            combined.forEach(function (v, i) {
                var lower = v.name.toLowerCase();
                var checked = excludedLower[lower] ? ' checked' : '';
                var cid = SCRIPT_ID + '-vendor-cb-' + i;
                var safeName = v.name.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                rowsHtml += '<label data-vendor-row data-vendor-name="' + lower.replace(/"/g, '&quot;') + '" for="' + cid + '" style="display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:3px;cursor:pointer;">'
                    + '<input type="checkbox" id="' + cid + '" data-vendor="' + safeName + '"' + checked + ' style="margin:0;flex:none;">'
                    + '<span style="flex:1;' + (checked ? 'color:#c0392b;font-weight:600;' : 'color:#222;') + '">' + v.name + '</span>'
                    + (v.count ? '<span style="color:#999;font-size:11px;flex:none;">' + v.count + ' PO' + (v.count === 1 ? '' : 's') + '</span>' : '')
                    + '</label>';
            });
        }

        mgr.innerHTML = '<div style="font-weight:600;color:#222;margin-bottom:6px;">Excluded Vendors &mdash; check any number, then Apply</div>'
            + '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">'
            + '<input id="' + searchId + '" placeholder="Filter vendors..." style="padding:5px 8px;border:1px solid #ccc;border-radius:3px;width:200px;font-size:12px;">'
            + '<button id="' + SCRIPT_ID + '-vendor-selall" style="background:#eee;color:#333;border:1px solid #ccc;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:12px;">Check all shown</button>'
            + '<button id="' + SCRIPT_ID + '-vendor-selnone" style="background:#eee;color:#333;border:1px solid #ccc;padding:4px 10px;border-radius:3px;cursor:pointer;font-size:12px;">Uncheck all shown</button>'
            + '</div>'
            + '<div id="' + listId + '" style="max-height:220px;overflow-y:auto;border:1px solid #e2e2e2;border-radius:3px;padding:4px 6px;background:#fff;margin-bottom:8px;">' + rowsHtml + '</div>'
            + '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'
            + '<input id="' + addId + '" placeholder="Add a vendor not listed above" style="padding:5px 8px;border:1px solid #ccc;border-radius:3px;width:220px;font-size:12px;">'
            + '<button id="' + SCRIPT_ID + '-vendor-addbtn" style="background:#eee;color:#333;border:1px solid #ccc;padding:5px 12px;border-radius:3px;cursor:pointer;font-size:12px;">Add to list</button>'
            + '<span style="flex:1;"></span>'
            + '<button id="' + SCRIPT_ID + '-vendor-clear" style="background:#eee;color:#333;border:1px solid #ccc;padding:6px 14px;border-radius:3px;cursor:pointer;font-size:12px;">Clear all exclusions</button>'
            + '<button id="' + SCRIPT_ID + '-vendor-apply" style="background:#c0392b;color:#fff;border:none;padding:6px 16px;border-radius:3px;cursor:pointer;font-size:12px;font-weight:600;">Apply</button>'
            + '</div>';

        var header = panel.querySelector('.audit-panel-tools');
        var anchor = header && header.parentNode ? header.parentNode : panel;
        anchor.parentNode.insertBefore(mgr, anchor.nextSibling);

        var searchEl = document.getElementById(searchId);
        if (searchEl) {
            searchEl.oninput = function () {
                var q = String(searchEl.value || '').trim().toLowerCase();
                var listEl = document.getElementById(listId);
                if (!listEl) return;
                listEl.querySelectorAll('[data-vendor-row]').forEach(function (row) {
                    var name = row.getAttribute('data-vendor-name') || '';
                    row.style.display = (!q || name.indexOf(q) !== -1) ? 'flex' : 'none';
                });
            };
        }

        var selAllBtn = document.getElementById(SCRIPT_ID + '-vendor-selall');
        if (selAllBtn) selAllBtn.onclick = function () {
            var listEl = document.getElementById(listId);
            if (!listEl) return;
            listEl.querySelectorAll('[data-vendor-row]').forEach(function (row) {
                if (row.style.display === 'none') return;
                var cb = row.querySelector('input[type=checkbox]');
                if (cb) cb.checked = true;
            });
        };
        var selNoneBtn = document.getElementById(SCRIPT_ID + '-vendor-selnone');
        if (selNoneBtn) selNoneBtn.onclick = function () {
            var listEl = document.getElementById(listId);
            if (!listEl) return;
            listEl.querySelectorAll('[data-vendor-row]').forEach(function (row) {
                if (row.style.display === 'none') return;
                var cb = row.querySelector('input[type=checkbox]');
                if (cb) cb.checked = false;
            });
        };

        var addBtn = document.getElementById(SCRIPT_ID + '-vendor-addbtn');
        var addInp = document.getElementById(addId);
        var doAdd = function () {
            var v = addInp ? String(addInp.value || '').trim() : '';
            if (!v) return;
            addExcludedVendor(v);
            if (onChanged) onChanged();
        };
        if (addBtn) addBtn.onclick = doAdd;
        if (addInp) addInp.onkeydown = function (e) { if (e.key === 'Enter') doAdd(); };

        var clearBtn = document.getElementById(SCRIPT_ID + '-vendor-clear');
        if (clearBtn) clearBtn.onclick = function () {
            saveExcludedVendors([]);
            if (onChanged) onChanged();
        };

        var applyBtn = document.getElementById(SCRIPT_ID + '-vendor-apply');
        if (applyBtn) applyBtn.onclick = function () {
            var listEl = document.getElementById(listId);
            var checkedNames = [];
            if (listEl) {
                listEl.querySelectorAll('input[type=checkbox]:checked').forEach(function (cb) {
                    var v = cb.getAttribute('data-vendor');
                    if (v) checkedNames.push(v);
                });
            }
            saveExcludedVendors(checkedNames);
            if (onChanged) onChanged();
        };
    }

    // Attach the page's Kendo date picker (adds the calendar button) to a modal
    // date input while keeping the dd-MMM-yyyy display. Returns true on success;
    // otherwise the input stays a plain text field.
    function initModalDatePicker(inputEl, defaultDate) {
        try {
            if (!inputEl || !$p || !$p.fn || !$p.fn.kendoDatePicker) return false;
            $p(inputEl).kendoDatePicker({
                format: 'dd-MMM-yyyy',
                value: defaultDate && !isNaN(defaultDate.getTime()) ? defaultDate : null
            });
            return true;
        } catch (e) {
            return false;
        }
    }

    function toDateInputValue(d) {
        if (!d || isNaN(d.getTime())) return '';
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function todayStart() {
        var d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function formatMoney(val) {
        if (val === null || val === undefined || isNaN(val)) return '$0.00';
        return '$' + Number(val).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  GRID HELPERS
    // ═════════════════════════════════════════════════════════════════════════

    function getKendoGrid(elementId) {
        try {
            return $p && $p('#' + (elementId || 'grid')).data('kendoGrid');
        } catch (e) { return null; }
    }

    function getGridData(grid) {
        if (!grid) return [];
        var ds = grid.dataSource;
        var all = ds.data();
        var items = ds.filter()
            ? kendo.data.Query.process(all, { filter: ds.filter(), sort: ds.sort() }).data
            : (all.toJSON ? all.toJSON() : [].slice.call(all));
        return items;
    }

    function clearDsCache(ds) {
        if (!ds) return;
        try { if (ds.options) ds.options.cache = false; } catch (e) {}
        try {
            if (ds.cache && typeof ds.cache.clear === 'function') ds.cache.clear();
        } catch (e) {}
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  CROSS-PAGE DISPATCHER
    // ═════════════════════════════════════════════════════════════════════════

    function dispatchReport(reportKey) {
        console.log('[AUDIT] dispatchReport called with:', reportKey);
        var report = REPORTS[reportKey];
        if (!report) return;

        if (!report.wired) {
            showToast(report.label + ' - not wired yet', 'warn');
            return;
        }

        var currentPath = location.pathname;
        var targetPage = report.page;

        // Remote reports fetch ALL their data via XHR, so they run from any page
        // in place — no navigation, no dependence on an on-page grid.
        if (report.remote) {
            showProgress('Running ' + report.label + '...');
            // Remote reports manage their own progress through finish() — the
            // next showProgress() in runWorkOrders supersedes this one, so do
            // NOT hide it here (hiding early blinked the popup off at 200ms).
            setTimeout(function () {
                runReport(reportKey);
            }, 200);
            return;
        }

        if (currentPath.indexOf(targetPage) === 0) {
            showProgress('Running ' + report.label + '...');
            waitForGrid(report.gridId, function () {
                setTimeout(function () {
                    runReport(reportKey);
                    hideProgress();
                }, 300);
            });
        } else {
            var dispatchDates = getDateRange();
            var dispatchCats = getSelectedCategories();
            var dispatchOffices = getSelectedOffices();
            var dispatchControlled = getControlledGoods();
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
                report: reportKey,
                ts: Date.now(),
                start: dispatchDates && dispatchDates.start ? dispatchDates.start.toISOString() : null,
                end: dispatchDates && dispatchDates.end ? dispatchDates.end.toISOString() : null,
                cats: dispatchCats,
                offices: dispatchOffices,
                controlledGoods: dispatchControlled,
                selectedRep: getSelectedRep(),
                excludeFrontEnd: getExcludeFrontEnd(),
                frontEndReps: getFrontEndRepsSnapshot(),
                manualNumber: (pendingFilters && pendingFilters.manualNumber != null) ? pendingFilters.manualNumber : '',
                manualApplyRange: !!(pendingFilters && pendingFilters.manualApplyRange),
                manualInhouseApplyRange: !!(pendingFilters && pendingFilters.manualInhouseApplyRange),
                gidepApplyRange: !!(pendingFilters && pendingFilters.gidepApplyRange)
            }));
            window.location.href = targetPage;
        }
    }

    function checkDispatch() {
        var raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        sessionStorage.removeItem(STORAGE_KEY);

        var data;
        try { data = JSON.parse(raw); } catch (e) { return; }
        if (!data || !data.report) return;
        if (Date.now() - (data.ts || 0) > 30000) return;

        // Restore the filters captured at click time — the modal is gone after
        // navigaton, so getDateRange()/getSelectedCategories() fall back to this.
        pendingFilters = {
            dates: {
                start: data.start ? new Date(data.start) : null,
                end: data.end ? new Date(data.end) : null
            },
            cats: data.cats || [],
            offices: data.offices || [],
            controlledGoods: !!data.controlledGoods,
            selectedRep: data.selectedRep || '',
            excludeFrontEnd: (typeof data.excludeFrontEnd === 'boolean') ? data.excludeFrontEnd : true,
            frontEndReps: (Array.isArray(data.frontEndReps)) ? data.frontEndReps.slice() : [],
            manualNumber: (data.manualNumber != null) ? String(data.manualNumber) : '',
            manualApplyRange: !!data.manualApplyRange,
            manualInhouseApplyRange: !!data.manualInhouseApplyRange,
            gidepApplyRange: !!data.gidepApplyRange
        };

        var report = REPORTS[data.report];
        if (!report || !report.wired) return;

        showProgress('Running ' + report.label + '...');
        waitForGrid(report.gridId, function () {
            setTimeout(function () {
                runReport(data.report);
                hideProgress();
            }, 500);
        });
    }

    function waitForGrid(elementId, callback, timeoutMs) {
        timeoutMs = timeoutMs || 15000;
        var elapsed = 0;
        var interval = 250;
        var timer = setInterval(function () {
            var g = getKendoGrid(elementId);
            if (g && g.dataSource) {
                clearInterval(timer);
                callback();
                return;
            }
            elapsed += interval;
            if (elapsed >= timeoutMs) {
                clearInterval(timer);
                hideProgress();
                showToast('Grid did not load in time', 'warn');
            }
        }, interval);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  FILTER LOGIC
    // ═════════════════════════════════════════════════════════════════════════

    function getSelectedCategories() {
        var modal = document.getElementById(MODAL_ID);
        if (modal) {
            var cats = [];
            modal.querySelectorAll('.cat-chip.active').forEach(function (el) {
                if (el.dataset.cat) cats.push(el.dataset.cat);
            });
            return cats;
        }
        // Modal is closed (same-page run or after cross-page dispatch) — use the
        // filters captured when the report button was clicked.
        if (pendingFilters && pendingFilters.cats) return pendingFilters.cats;
        return [];
    }

    function getDateRange() {
        var startEl = document.getElementById(SCRIPT_ID + '-date-start');
        var endEl = document.getElementById(SCRIPT_ID + '-date-end');
        if ((startEl && startEl.value) || (endEl && endEl.value)) {
            return {
                start: startEl && startEl.value ? formatDateInput(startEl.value) : null,
                end: endEl && endEl.value ? formatDateInput(endEl.value) : null
            };
        }
        // Modal is closed (same-page run or after cross-page dispatch) — use the
        // filters captured when the report button was clicked.
        if (pendingFilters && pendingFilters.dates) return pendingFilters.dates;
        return { start: null, end: null };
    }

    // Controlled Goods — when enabled, only customers whose Company name
    // contains "BELL HELICOPTERS TEXTRON" are included in the Work Orders report.
    function getControlledGoods() {
        var modal = document.getElementById(MODAL_ID);
        if (modal) {
            var chi = document.getElementById(SCRIPT_ID + '-controlled-goods');
            return !!(chi && chi.checked);
        }
        if (pendingFilters && pendingFilters.controlledGoods !== undefined) return pendingFilters.controlledGoods;
        return false;
    }

    // The grid's own #startDate/#endDate kendoDatePickers drive the actual
    // server-side search (via searchGrid()) independently of our
    // dataSource.filter() call. Setting only dataSource.filter() left the
    // native pickers on whatever they last showed, so the server kept
    // returning everything back to 2022. Push our modal's dates into the
    // real pickers and fire their bound change handlers before searching.
    function syncDatesToPage(dates) {
        try {
            var appStart = document.getElementById('startDate');
            var appEnd = document.getElementById('endDate');
            var appSD = $p && appStart ? $p(appStart).data('kendoDatePicker') : null;
            var appED = $p && appEnd ? $p(appEnd).data('kendoDatePicker') : null;
            if (appSD && dates.start) {
                appSD.value(dates.start);
                appSD.trigger('change');
            }
            if (appED && dates.end) {
                appED.value(dates.end);
                appED.trigger('change');
            }
        } catch (e) {
            console.error('[AUDIT] syncDatesToPage failed', e);
        }
    }

    function buildFilters(dateField, extraFilters) {
        var filters = [];
        var dates = getDateRange();
        var cats = getSelectedCategories();

        if (dates.start) {
            filters.push({ field: dateField, operator: 'gte', value: dates.start });
        }
        if (dates.end) {
            var endDay = new Date(dates.end);
            endDay.setHours(23, 59, 59, 999);
            filters.push({ field: dateField, operator: 'lte', value: endDay });
        }

        if (cats.length > 0) {
            var orFilters = cats.map(function (c) {
                return { field: 'Category', operator: 'eq', value: c };
            });
            filters.push({ logic: 'or', filters: orFilters });
        }

        if (extraFilters) {
            extraFilters.forEach(function (f) { filters.push(f); });
        }

        return filters.length > 0 ? { logic: 'and', filters: filters } : [];
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  REPORT RUNNERS
    // ═════════════════════════════════════════════════════════════════════════

    function runReport(reportKey) {
        console.log('[AUDIT] runReport called with:', reportKey);
        switch (reportKey) {
            case 'workOrders': runWorkOrders(false, false, 'workOrders'); break;
            case 'warranty': runWorkOrders(true, false, 'warranty'); break;
            case 'subcontract': runWorkOrders(false, true, 'subcontract'); break;
            case 'purchaseOrders': runPurchaseOrders(); break;
            case 'timeSensitiveLib': runTimeSensitiveLib(); break;
            case 'manualUsage': runManualUsage(); break;
            case 'manualInhouse': runManualInhouse(); break;
            case 'gidep': runManualInhouse('BL', 'gidep'); break;
            case 'toolsAll': runAeroTools(); break;
            case 'inventoryInStock': runInventory(true); break;
            case 'inventoryAll': runInventory(false, true); break;
            default:
                showToast(REPORTS[reportKey].label + ' - not wired yet', 'warn');
        }
    }

    // Accepts Date objects, numbers, dd-MMM-yyyy / dd-MMM-yyyy h:mm tt,
    // yyyy-MM-dd, ISO, and the grid's own "2026-08-27 01:29 PM" format.
    function parseDateValue(value) {
        if (!value) return null;
        if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
        if (typeof value === 'number') {
            var nd = new Date(value);
            return isNaN(nd.getTime()) ? null : nd;
        }
        var s = String(value).trim();
        if (!s) return null;
        var parsed = formatDateInput(s);
        if (parsed && !isNaN(parsed.getTime())) return parsed;

        // YYYY-MM-DD h:mm[:ss] AM/PM  (what the Work Orders grid actually renders)
        var m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(s);
        if (m) {
            var hh = parseInt(m[4], 10);
            var mm = parseInt(m[5], 10);
            var ss = m[6] ? parseInt(m[6], 10) : 0;
            var ap = m[7] ? m[7].toUpperCase() : '';
            if (ap === 'PM' && hh < 12) hh += 12;
            if (ap === 'AM' && hh === 12) hh = 0;
            var dt = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), hh, mm, ss);
            return isNaN(dt.getTime()) ? null : dt;
        }

        var fallback = new Date(s);
        return isNaN(fallback.getTime()) ? null : fallback;
    }

    function getBristowStatus(r) {
        var cf = r.CustomFieldValues;
        if (!cf) return '';
        if (cf.length !== undefined) {
            var first = cf[0];
            return first && first.Value !== undefined && first.Value !== null ? String(first.Value) : '';
        }
        return cf.Value !== undefined && cf.Value !== null ? String(cf.Value) : '';
    }

    // Criteria mirror the page's column filter menus exactly:
    //   Order Status  = "Complete"      (value 2 of 0/1/2/3/4 = Open/In Progress/Complete/Cancelled/Ready)
    //   Bristow Status = "Shipped"      (free-text field, CustomFieldValues[0].Value)
    //   Created At     = Is after or equal to  AND  Is before or equal to (end day inclusive)

    // Controlled-goods customer match. Company values can arrive as a plain
    // string or as an object with a .Name; both "BELL HELICOPTERS TEXTRON INC"
    // and "BELL HELICOPTERS TEXTRON INC (USD)" share the matching keyword.
    function isControlledGoodsCustomer(val) {
        if (val == null) return false;
        var s = '';
        if (typeof val === 'object' && !(val instanceof Date)) {
            s = String((val.Name != null) ? val.Name : '');
        } else {
            s = String(val);
        }
        s = s.toUpperCase().trim();
        return s.indexOf('BELL HELICOPTERS TEXTRON') !== -1;
    }

    function filterWorkOrderRows(all, dates, offices, controlledGoods) {
        var endOfDay = null;
        if (dates.end) {
            endOfDay = new Date(dates.end);
            endOfDay.setHours(23, 59, 59, 999);
        }
        var startT = dates.start ? dates.start.getTime() : null;
        var endT = endOfDay ? endOfDay.getTime() : null;

        // Controlled Goods — keep only customers whose Company contains the
        // keyword "BELL HELICOPTERS TEXTRON". Matches the Customer column filter.

        // Offices selected in the modal (GUID values). The page's #officeSelect
        // is also set to these so the server narrows via OfficeIdList; row-level
        // PrimaryOffice may carry the GUID or the office display text, so match
        // against both.
        var officeKeys = null;
        var officeTexts = null;
        if (offices && offices.length) {
            officeKeys = {};
            officeTexts = {};
            offices.forEach(function (v) {
                officeKeys[v] = true;
                getOfficeOptions().forEach(function (o) {
                    if (o.value === v) officeTexts[o.text] = true;
                });
            });
        }

        return all.filter(function (r) {
            if (Number(r.OrderStatus) !== 2) return false;
            if (getBristowStatus(r).trim().toLowerCase() !== 'shipped') return false;
            if (officeKeys) {
                var po = r.PrimaryOffice != null ? String(r.PrimaryOffice) : '';
                if (!officeKeys[po] && !officeTexts[po]) return false;
            }
            if (controlledGoods && !isControlledGoodsCustomer(r.Company)) return false;
            if (startT !== null || endT !== null) {
                var d = parseDateValue(r.CreatedAt);
                if (!d) return false;
                var t = d.getTime();
                if (startT !== null && t < startT) return false;
                if (endT !== null && t > endT) return false;
            }
            return true;
        });
    }

    // ── Order-Rep filter (ApplicationUsers) ──
    // Single-select rep dropdown + "Exclude Front End" toggle, powered by the
    // app's /Identity/Users?handler=ApplicationUsers list (cached for a day).
    // Dropdown shows ENABLED users whose email domain matches the selected
    // office(s): Bristow bases (YEG/YLW) -> @bristow.ca, VSI YYC Base ->
    // @vi-scan.com; any other domain is omitted. No office -> all enabled.
    // Front-end staff = enabled users whose roles aren't exactly [Technician].
    // Picking a rep shows only that rep's rows; otherwise front-end staff are
    // dropped when the checkbox is on.

    // Collapses interior whitespace and lower-cases a display name so grid
    // OrderRep values ("Celso Sinongco") match Users FullName values even when
    // one side has stray double spaces.
    function normalizeName(name) {
        return String(name || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    // Splits a "Role A, Role B" string into trimmed role names (empty parts dropped).
    function parseRoles(rolesStr) {
        var out = [];
        String(rolesStr || '').split(',').forEach(function (r) {
            var t = r.trim();
            if (t) out.push(t);
        });
        return out;
    }

    // Enabled users whose roles aren't exactly ["technician"] are "front-end"
    // (Sales, Management, etc.). Users with no roles are treated as back-end.
    function isFrontEndUser(u) {
        var roles = (u && Array.isArray(u.roles)) ? u.roles : [];
        if (!roles.length) return false;
        var unique = {};
        roles.forEach(function (r) { unique[String(r).toLowerCase()] = true; });
        if (Object.keys(unique).length === 1 && unique.technician) return false;
        return true;
    }

    // Fetches (with a 1-day GM cache + in-memory memoization) the app's user
    // list and stores normalized records in the module-level USERS variable.
    function fetchUsers(force) {
        if (USERS_PROMISE && !force) return USERS_PROMISE;
        USERS_PROMISE = new Promise(function (resolve) {
            var cached = null;
            USERS = null;
            try {
                var raw = GM_getValue(USERS_CACHE_KEY, null);
                var age = GM_getValue(USERS_CACHE_AGE_KEY, 0);
                if (raw && age && (Date.now() - age) < USERS_CACHE_MAX_AGE) {
                    cached = JSON.parse(raw);
                }
            } catch (e) {}
            function done(users) {
                USERS = users || [];
                resolve(USERS);
            }
            if (Array.isArray(cached) && cached.length) {
                done(cached);
                return;
            }
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', '/Identity/Users?handler=ApplicationUsers', true);
                xhr.timeout = 60000;
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4) return;
                    if (xhr.status !== 200) { done(cached || []); return; }
                    try {
                        var body = JSON.parse(xhr.responseText);
                        var list = Array.isArray(body) ? body
                            : (body && Array.isArray(body.Data)) ? body.Data : [];
                        var recs = list.map(function (u) {
                            var disp = String(u.FullName || '').replace(/\s+/g, ' ').trim();
                            return {
                                id: u.Id || '',
                                userName: u.UserName || '',
                                email: String(u.Email || '').toLowerCase(),
                                fullName: disp,
                                normalized: normalizeName(u.FullName),
                                roles: parseRoles(u.Roles),
                                enabled: u.IsEnabled !== false && !u.IsLockedOut
                            };
                        });
                        try {
                            GM_setValue(USERS_CACHE_KEY, JSON.stringify(recs));
                            GM_setValue(USERS_CACHE_AGE_KEY, Date.now());
                        } catch (e) {}
                        done(recs);
                    } catch (e) { done(cached || []); }
                };
                xhr.onerror = function () { done(cached || []); };
                xhr.ontimeout = function () { done(cached || []); };
                xhr.send();
            } catch (e) {
                done(cached || []);
            }
        });
        return USERS_PROMISE;
    }

    // Map of normalized rep name -> true for every enabled front-end user.
    function getFrontEndReps() {
        var map = {};
        if (Array.isArray(USERS)) {
            USERS.forEach(function (u) {
                if (u.enabled && isFrontEndUser(u)) map[u.normalized] = true;
            });
        } else if (pendingFilters && Array.isArray(pendingFilters.frontEndReps)) {
            pendingFilters.frontEndReps.forEach(function (n) { map[normalizeName(n)] = true; });
        }
        return map;
    }

    // Array of normalized front-end names for serializing into pendingFilters /
    // the cross-page dispatch payload.
    function getFrontEndRepsSnapshot() {
        return Object.keys(getFrontEndReps());
    }

    // Rep selected in the modal dropdown ('' = all reps), or the snapshot for
    // same-page / cross-page dispatch runs.
    function getSelectedRep() {
        var modal = document.getElementById(MODAL_ID);
        if (modal) {
            var sel = modal.querySelector('#' + SCRIPT_ID + '-rep-select');
            if (sel) return sel.value || '';
        }
        if (pendingFilters && pendingFilters.selectedRep) return pendingFilters.selectedRep;
        return '';
    }

    // "Exclude Front End" checkbox state; defaults ON so front-end staff don't
    // clutter the report even when run without opening the modal.
    function getExcludeFrontEnd() {
        var modal = document.getElementById(MODAL_ID);
        if (modal) {
            var cb = modal.querySelector('#' + SCRIPT_ID + '-exclude-front-end');
            if (cb) return cb.checked;
        }
        if (pendingFilters && typeof pendingFilters.excludeFrontEnd === 'boolean') {
            return pendingFilters.excludeFrontEnd;
        }
        return true;
    }

    // True when an office chip's GUID is the VSI YYC Base (matched by GUID or by
    // display text containing "VSI").
    function isVsiOffice(value) {
        var text = '';
        getOfficeOptions().forEach(function (o) { if (o.value === value) text = o.text; });
        if (/VSI/i.test(text)) return true;
        return value === OFFICES[2].value;
    }

    // Fetch the Work Orders grid WITHOUT the CreatedAt date filter so we can get
    // Order Rep (and other columns) for ALL orders — including shipped orders that
    // were created outside the audit date range. Returns a Promise<orderNoMap> where
    // orderNoMap[orderNumber] = { id, rep, customer, component, serialNo, createdAt }.
    // Maps orderNo -> { id, rep, customer, component, serialNo, officeRaw,
    // createdAt } for every Work Order, fetched via XHR from the grid handler so
    // the report can run from ANY page instead of having to navigate to
    // /Orders/Orders and read the on-page grid.
    function bulkFetchOrderRepMap() {
        return fetchOrdersGridData().then(function (res) {
            if (res.error) {
                console.warn('[AUDIT] Work Orders grid fetch failed: ' + res.error);
                return {};
            }
            var map = {};
            for (var i = 0; i < res.rows.length; i++) {
                var r = res.rows[i];
                var orderNo = r.OrderNumber || '';
                if (!orderNo) continue;
                var offRaw = '';
                var po = r.PrimaryOffice;
                if (po != null) {
                    offRaw = (po && po.Name != null) ? String(po.Name) : String(po);
                }
                if (!map[orderNo]) {
                    map[orderNo] = {
                        id: r.Id || '',
                        rep: r.OrderRep != null ? String(r.OrderRep) : '',
                        customer: (r.Company && typeof r.Company === 'object' && r.Company.Name != null) ? String(r.Company.Name) : (r.Company != null ? String(r.Company) : ''),
                        component: r.Aero ? (r.Aero.Component || '') : '',
                        serialNo: r.Aero ? (r.Aero.SerialNumber || '') : '',
                        officeRaw: offRaw,
                        bsFieldId: getWoBsFieldId(r),
                        createdAt: r.CreatedAt ? new Date(r.CreatedAt) : null,
                        orderStatus: r.OrderStatus != null ? Number(r.OrderStatus) : null,
                        bsStatus: getWoBsStatusValue(r)
                    };
                }
            }
            return map;
        });
    }

    // ── Work Orders report (Orders-grid-only) ──
    // All shipped-order data comes from the Work Orders grid + each order's
    // Bristow Status field history.  No Communication Report dependency.
    // Filter: OrderNumber prefix YEG/BRI, OrderStatus = Complete (2),
    // Bristow Status contains "Shipped", shipped date in user's range
    // (from Bristow Status history, not CreatedAt).
    // Work Orders grid page-scan entry point. warrantyOnly=true runs the Warranty
    // report (only orders whose Edit-page "Is Warranty" flag is checked). The
    // "Warranty" column (right of Cost Center) always appears in the embedded
    // table and Excel export — every row's flag is cached. The printable list
    // intentionally does NOT include it.
    var warrantyColumnActive = true;
    function runWorkOrders(warrantyOnly, subcontractOnly, sourceKey) {
        // Title prefix reflects which button was pressed (Work Orders / Warranty /
        // Subcontracts) so the panel + printout say e.g. "Warranty Work Order
        // Shipped — Combined  405".
        var woTitlePrefix = (sourceKey && REPORTS[sourceKey] && REPORTS[sourceKey].label) || 'Work Orders';
        var dates = getDateRange();
        var cats = getSelectedCategories();
        var offices = getSelectedOffices();
        var controlledGoods = getControlledGoods();

        // Force Rebuild is now an immediate-action button (in the cache section)
        // that clears CC + Warranty + Sub-Contract + History caches on click, so
        // the run itself needs no refresh flag — empty caches rebuild naturally.
        var forceRefresh = false;

        showProgress('Loading completed/shipped orders from Work Orders grid...');

        // Ensure the rep list is loaded (cached fetch) so the front-end staff
        // set is available before rows are built.
        fetchUsers()
            .then(function () { return bulkFetchOrderRepMap(); })
            .then(function (woMap) {
            // Filter to YEG/BRI orders that are Completed + Shipped
            var filtered = {};
            Object.keys(woMap).forEach(function (no) {
                var w = woMap[no];
                var seg = officeCodeFromOrder(no);
                if (seg !== 'YEG' && seg !== 'BRI') return;
                if (w.orderStatus !== 2) return;
                var bs = (w.bsStatus || '').trim().toLowerCase();
                if (bs.indexOf('shipped') === -1) return;
                filtered[no] = w;
            });

            var filteredCount = Object.keys(filtered).length;
            if (filteredCount === 0) {
                hideProgress();
                showToast('No completed/shipped YEG/BRI orders found in the grid', 'info');
                return;
            }

            showProgress('Checking Bristow Status history for ' + filteredCount + ' orders...');
            expandShipDatesFromHistory(filtered, dates, null, forceRefresh)
                .catch(function () { return {}; })
                .then(function (sdMap) {
                    // Merge: use history-recovered shipped dates where available;
                    // fall back to CreatedAt for orders where the history scan
                    // couldn't determine a shipped date (Edit-page lookup failed
                    // or no parseable Shipped transition).  This ensures ALL
                    // currently-shipped orders appear in the report — matching
                    // the website's filtered count — even if their exact shipped
                    // date is unknown.
                    var mergedDates = {};
                    Object.keys(filtered).forEach(function (no) {
                        if (sdMap[no]) {
                            mergedDates[no] = sdMap[no];
                        } else {
                            var w = filtered[no];
                            if (w.createdAt) mergedDates[no] = w.createdAt;
                        }
                    });
                    var shippedOrders = Object.keys(mergedDates);
                    if (shippedOrders.length === 0) {
                        hideProgress();
                        showToast('No shipped orders found for the selected range', 'info');
                        return;
                    }

                    // The order-number list the report ultimately runs on; set by
                    // the warranty step below when that report is active.
                    var reportOrderNos = shippedOrders;

                    // ── Cost Center fetch + row build for the report orders ──
                    function finalizeReport() {
                        var cache = getCCCache();
                        var warrantyCache = getWarrantyCache();
                        var subcontractCache = getSubcontractCache();
                        var orderIds = reportOrderNos.map(function (no) {
                            return (woMap[no] && woMap[no].id) || '';
                        }).filter(Boolean);
                        var missingIds = orderIds.filter(function (id) { return id && !(id in cache); });
                        var needFetch = forceRefresh || isCCCacheStale() || missingIds.length > 0;

                        // ── Row-level filter setup ──
                        var sRangeStart = null, sRangeEnd = null;
                        if (dates.start) {
                            sRangeStart = new Date(dates.start);
                            sRangeStart.setHours(0, 0, 0, 0);
                        }
                        if (dates.end) {
                            sRangeEnd = new Date(dates.end);
                            sRangeEnd.setHours(23, 59, 59, 999);
                        }

                        function passesRow(r) {
                            if (r.shippedDate) {
                                var t = r.shippedDate.getTime();
                                if (sRangeStart && t < sRangeStart.getTime()) return false;
                                if (sRangeEnd && t > sRangeEnd.getTime()) return false;
                            }
                            if (cats.length > 0 && !all6Active) {
                                var inSix = !!(r.costCenterKey && original6Set[r.costCenterKey]);
                                var selected = !!(r.costCenterKey && catSetForRows[r.costCenterKey]);
                                if (inSix) {
                                    if (!selected) return false;                      // 6-category chip unselected
                                } else {
                                    if (!catSetForRows[CATEGORY_MISSING]) return false; // missing/mismatched excluded
                                }
                            }
                            if (officeKeys || officeTexts) {
                                var po = r.officeRaw != null ? String(r.officeRaw) : '';
                                var ok = (officeKeys && officeKeys[po]) || (officeTexts && officeTexts[po]);
                                if (!ok) {
                                    var seg = officeCodeFromOrder(r.order);
                                    var segText = OFFICE_SEG_TEXT[seg] || '';
                                    var segOffice = OFFICE_SEG_NAME[seg] || '';
                                    var ok2 = (officeKeys && officeKeys[segOffice]) ||
                                              (officeTexts && officeTexts[segText]) ||
                                              (officeTexts && officeTexts[segOffice]);
                                    if (!ok2) return false;
                                }
                            }
                            if (controlledGoods && !isControlledGoodsCustomer(r.customer)) return false;
                            return true;
                        }

                        var officeKeys = null, officeTexts = null;
                        if (offices && offices.length) {
                            officeKeys = {};
                            officeTexts = {};
                            offices.forEach(function (v) {
                                officeKeys[v] = true;
                                getOfficeOptions().forEach(function (o) { if (o.value === v) officeTexts[o.text] = true; });
                            });
                        }
                        var catSetForRows = {};
                        if (cats.length > 0) cats.forEach(function (c) { catSetForRows[c.toUpperCase()] = true; });
                        var original6Set = {};
                        CATEGORIES.forEach(function (c) { original6Set[c] = true; });
                        var all6Active = catSetForRows[CATEGORY_MISSING] ? CATEGORIES.every(function (c) { return catSetForRows[c]; }) : false;

                        function buildRows(ccMap) {
                            var rows = [];
                            reportOrderNos.forEach(function (orderNo) {
                                var w = woMap[orderNo] || {};
                                var costCenter = ccMap[w.id] || '';
                                rows.push({
                                    order: orderNo,
                                    orderId: w.id || '',
                                    customer: w.customer || '',
                                    component: w.component || '',
                                    serialNo: w.serialNo || '',
                                    costCenter: costCenter,
costCenterKey: extractCategoryCode(costCenter),
                                        warranty: (w.id && warrantyCache[w.id] === true) ? 'Yes' : 'No',
                                        subcontract: (w.id && subcontractCache[w.id] === true) ? 'Yes' : 'No',
                                    rep: w.rep || '',
                                    shippedDate: mergedDates[orderNo] || null,
                                    createdAt: w.createdAt || null,
                                    officeRaw: w.officeRaw || '',
                                    poDocs: w.poDocs || []
                                });
                            });

                            // Rep filter: if a specific rep is chosen, only their rows
                            // survive (front-end checkbox ignored). Otherwise, when
                            // "Exclude Front End" is on, drop rows whose order rep is a
                            // front-end employee. Keys are normalizeName()d so stray
                            // double spaces in User FullName can't break the match.
var repKey = normalizeName(getSelectedRep());
                        if (repKey) {
                            rows = rows.filter(function (r) { return normalizeName(r.rep) === repKey; });
                        } else if (getExcludeFrontEnd() && !subcontractOnly) {
                            // The Subcontracts report ignores the "Exclude Front End"
                            // checkbox — every subcontract order (any rep) is included.
                            var frontEndMap = getFrontEndReps();
                                if (Object.keys(frontEndMap).length) {
                                    rows = rows.filter(function (r) { return !frontEndMap[normalizeName(r.rep)]; });
                                }
                            }

                            rows = rows.filter(passesRow);
                            rows.sort(function (a, b) {
                                var ta = a.shippedDate && a.shippedDate.getTime ? a.shippedDate.getTime() : Math.pow(2, 53);
                                var tb = b.shippedDate && b.shippedDate.getTime ? b.shippedDate.getTime() : Math.pow(2, 53);
                                if (ta !== tb) return ta - tb;
                                return (a.createdAt || 0) - (b.createdAt || 0);
                            });
                            return rows;
                        }

                        function finish(ccMap) {
                            var rows = buildRows(ccMap);
                            if (rows.length === 0) {
                                hideProgress();
                                showToast(warrantyOnly ? 'No warranty orders match the current filters' : (subcontractOnly ? 'No subcontract orders match the current filters' : 'No work orders match the current filters'), 'info');
                                return;
                            }
                            // Fetch the "Manual Used" numbers (cached) for the
                            // new export column. The panel is displayed after
                            // these resolve so the on-screen count is accurate.
                            var manualIds = rows.map(function (r) { return r.orderId || ''; }).filter(Boolean);
                            if (!manualIds.length) {
                                hideProgress();
                                embedWorkOrdersTable(rows, function () { exportWorkOrdersExcel(rows); }, woTitlePrefix, subcontractOnly);
                                return;
                            }
                            showProgress('Fetching manuals (' + manualIds.length + ')...');
                            resolveManualsByIds(manualIds, function (d, t) {
                                showProgress('Fetching manuals (' + d + '/' + t + ')...');
                            }).then(function (mc) {
                                hideProgress();
                                rows.forEach(function (r) {
                                    if (r.orderId) r.manualUsed = mc[r.orderId] || '';
                                });
                                embedWorkOrdersTable(rows, function () { exportWorkOrdersExcel(rows); }, woTitlePrefix, subcontractOnly);
                            }).catch(function () {
                                hideProgress();
                                embedWorkOrdersTable(rows, function () { exportWorkOrdersExcel(rows); }, woTitlePrefix, subcontractOnly);
                            });
                        }

                        if (!needFetch) {
                            finish(cache);
                            return;
                        }
                        showProgress('Fetching Cost Centers (' + missingIds.length + ')...');
                        var idsToFetch = (forceRefresh || isCCCacheStale()) ? orderIds : missingIds;
                        fetchCCBatch(idsToFetch, function (d, t) {
                            showProgress('Fetching Cost Centers (' + d + '/' + t + ')...');
                        }).then(function (ccMap) {
                            finish(ccMap);
                        }).catch(function () {
                            hideProgress();
                            showToast('Cost Center fetch failed — re-run to resume', 'warn');
                        });
                    }

                    // ── Warranty-only: keep only orders whose "Is Warranty" flag is on ──
                    function warrantyFlow() {
                        var warrantyCache = getWarrantyCache();
                        var wIds = shippedOrders.map(function (no) {
                            return (woMap[no] && woMap[no].id) || '';
                        }).filter(Boolean);
                        var wMissing = wIds.filter(function (id) { return id && !(id in warrantyCache); });

                        function applyFilter() {
                            reportOrderNos = shippedOrders.filter(function (no) {
                                var w = woMap[no] || {};
                                return w.id && warrantyCache[w.id] === true;
                            });
                            if (reportOrderNos.length === 0) {
                                hideProgress();
                                showToast('No warranty orders found for the selected range', 'info');
                                return;
                            }
                            finalizeReport();
                        }

                        if (wMissing.length === 0) {
                            applyFilter();
                        } else {
                            showProgress('Checking Warranty status (' + wMissing.length + ' orders)...');
                            fetchWarrantyBatch(wIds).then(function (wc) {
                                warrantyCache = wc;
                                applyFilter();
                            }).catch(function () {
                                hideProgress();
                                showToast('Warranty check failed — re-run to resume', 'warn');
                            });
                        }
                    }

                    // ── Sub-Contract-only: keep only orders with a "Sub-Contract" line ──
                    function subcontractFlow() {
                        var scCache = getSubcontractCache();
                        var scIds = shippedOrders.map(function (no) {
                            return (woMap[no] && woMap[no].id) || '';
                        }).filter(Boolean);
                        var scMissing = scIds.filter(function (id) { return id && !(id in scCache); });

                        function applyFilter() {
                            reportOrderNos = shippedOrders.filter(function (no) {
                                var w = woMap[no] || {};
                                return w.id && scCache[w.id] === true;
                            });
                            if (reportOrderNos.length === 0) {
                                hideProgress();
                                showToast('No subcontract orders found for the selected range', 'info');
                                return;
                            }
                            // Fetch PO documents for subcontract orders
                            var docOrderIds = [];
                            var docSeen = {};
                            reportOrderNos.forEach(function (no) {
                                var w = woMap[no] || {};
                                if (w.id && !docSeen[w.id]) {
                                    docSeen[w.id] = true;
                                    docOrderIds.push(w.id);
                                }
                            });
                            if (docOrderIds.length === 0) {
                                finalizeReport();
                            } else {
                                showProgress('Fetching PO documents (' + docOrderIds.length + ' orders)...');
                                fetchOrderDocsBatch(docOrderIds).then(function (docCache) {
                                    hideProgress();
                                    // Attach PO documents (filtered) to rows
                                    reportOrderNos.forEach(function (no) {
                                        var w = woMap[no] || {};
                                        var dc = w.id ? docCache[w.id] : null;
                                        var docs = (dc && Array.isArray(dc.docs)) ? dc.docs : [];
                                        // Filter for documents with "PO" or "Purchase Order" in name (case-insensitive)
                                        w.poDocs = docs.filter(function (d) { return /PO|Purchase Order/i.test(d.name || ''); });
                                    });
                                    finalizeReport();
                                });
                            }
                        }

                        if (scMissing.length === 0) {
                            applyFilter();
                        } else {
                            showProgress('Checking Sub-Contract status (' + scMissing.length + ' orders)...');
                            fetchSubcontractBatch(scIds).then(function (sc) {
                                scCache = sc;
                                applyFilter();
                            }).catch(function () {
                                hideProgress();
                                showToast('Sub-Contract check failed — re-run to resume', 'warn');
                            });
                        }
                    }

                    if (warrantyOnly) {
                        warrantyFlow();
                    } else if (subcontractOnly) {
                        subcontractFlow();
                    } else {
                        finalizeReport();
                    }
                });
        });
    }

    function precacheCompletedShippedOrders() {
        var g = getKendoGrid('grid');
        if (!g) {
            showToast('Work Orders grid not found', 'warn');
            return;
        }

        var dates = getDateRange();
        var offices = getSelectedOffices();
        var controlledGoods = getControlledGoods();
        showProgress('Finding completed/shipped orders...');

        var origPageSize = g.dataSource.pageSize();

        // ── Enable "Show Complete and Cancelled" so the server includes them ──
        try {
            if ($p) {
                var sw = $p('#wCompleted').data('kendoSwitch');
                if (sw && !sw.value()) sw.value(true);
            }
        } catch (e) {}

        // ── Set the page's office multiselect (server OfficeIdList) ──
        setPageOffices(offices);

        g.dataSource.pageSize(99999);

        // ── Apply the filters to the grid itself (fields/values the column
        //    filter menus use) so the on-page grid visibly shows the applied
        //    state. Kendo applies these client-side; we still re-filter the raw
        //    data in plain JS below as the source of truth. ──
        try {
            var gridFilters = [
                { field: 'OrderStatus', operator: 'eq', value: 2 },
                { field: 'CustomFieldValues[0].Value', operator: 'eq', value: 'Shipped' }
            ];
            if (dates.start) {
                gridFilters.push({ field: 'CreatedAt', operator: 'gte', value: dates.start });
            }
            if (dates.end) {
                var gridEnd = new Date(dates.end);
                gridEnd.setHours(23, 59, 59, 999);
                gridFilters.push({ field: 'CreatedAt', operator: 'lte', value: gridEnd });
            }
            g.dataSource.filter(gridFilters);
        } catch (e) {
            try { g.dataSource.filter([]); } catch (e2) {}
        }

        var done = false;
        var cleanup = null;

        var onDone = function () {
            var items = filterWorkOrderRows([].slice.call(g.dataSource.data()), dates, offices, controlledGoods);
            try { g.dataSource.pageSize(origPageSize); } catch (e) {}

            var orderIds = items.map(function (r) { return r.Id || ''; }).filter(Boolean);
            var unique = Object.keys(orderIds.reduce(function (acc, id) { acc[id] = true; return acc; }, {}));

            if (unique.length === 0) {
                hideProgress();
                showToast('No completed/shipped orders match the current date range', 'info');
                return;
            }

            showProgress('Pre-caching Cost Centers (0/' + unique.length + ')...');
            fetchCCBatch(unique, function (doneCount, total) {
                showProgress('Pre-caching Cost Centers (' + doneCount + '/' + total + ')...');
            }).then(function () {
                hideProgress();
                showToast('Cache ready: ' + unique.length + ' orders', 'success');
                var ci = document.getElementById(SCRIPT_ID + '-cache-info');
                if (ci) {
                    var cacheRaw = GM_getValue(CC_CACHE_KEY, null);
                    var count = cacheRaw ? Object.keys(JSON.parse(cacheRaw)).length : 0;
                    ci.textContent = 'Cache: ' + count + ' orders, 0d old';
                }
            });
        };

        var handler = function () {
            if (done) return;
            done = true;
            g.dataSource.unbind('requestEnd', handler);
            if (cleanup) { clearTimeout(cleanup); cleanup = null; }
            setTimeout(onDone, 300);
        };
        g.dataSource.bind('requestEnd', handler);

        if (typeof searchGrid === 'function') {
            searchGrid();
        } else {
            g.dataSource.read();
        }

        cleanup = setTimeout(function () {
            if (done) return;
            done = true;
            g.dataSource.unbind('requestEnd', handler);
            onDone();
        }, 15000);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  PRINT: WORK ORDERS
    // ═════════════════════════════════════════════════════════════════════════

    function generateWorkOrdersPrintout(rows, onExport, titlePrefix) {
        var dates = getDateRange();
        var dateLabel = '';
        if (dates.start && dates.end) {
            dateLabel = toDisplayDate(dates.start) + ' to ' + toDisplayDate(dates.end);
        } else if (dates.start) {
            dateLabel = 'From ' + toDisplayDate(dates.start);
        } else if (dates.end) {
            dateLabel = 'Up to ' + toDisplayDate(dates.end);
        } else {
            dateLabel = 'All dates';
        }

        var h = '<html><head><title>Work Orders</title><style>';
        h += 'body{font-family:Arial,sans-serif;font-size:8px;margin:20px}';
        h += 'table{border-collapse:collapse;width:100%;font-size:8px}';
        h += 'th{background:#fff;color:#000;padding:5px 8px;text-align:left;font-size:12px;border-bottom:1px solid #999;font-weight:bold}';
        h += 'td{padding:4px 8px;border-bottom:1px solid #999;vertical-align:top;font-size:8px}';
        h += 'tr:nth-child(even) td{background:#f5f5f5}';
        h += '.mono{font-family:monospace}';
        h += '@media print{button{display:none}}';
        h += '</style></head><body>';
        h += '<h2>' + (titlePrefix && titlePrefix !== 'Work Orders' ? titlePrefix + ' ' : '') + 'Work Orders (Shipped) &mdash; ' + rows.length + '</h2>';
        h += '<p style="font-size:10px;color:#666;">Date Range: ' + dateLabel + ' | Generated: ' + toDisplayDate(new Date()) + '</p>';
        h += '<div style="margin-top:8px;margin-bottom:12px;display:flex;gap:8px;">';
        h += '<button onclick="window.print()" style="background:#378ADD;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Print</button>';
        h += '<button onclick="window.close()" style="background:#666;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Close</button>';
        h += '</div>';
        h += '<table><thead><tr>';
        h += '<th>#</th><th>Order</th><th>Customer</th><th>Component</th><th>Serial No.</th><th>Cost Center</th><th>Order Rep</th><th>Shipped Date</th>';
        h += '</tr></thead><tbody>';

        rows.forEach(function (r, i) {
            var shipStr = r.shippedDate ? (String(r.shippedDate.getDate()).padStart(2, '0') + '-' + MONTHS[r.shippedDate.getMonth()] + '-' + r.shippedDate.getFullYear()) : '';

            h += '<tr>';
            h += '<td>' + (i + 1) + '</td>';
            h += '<td class="mono">' + r.order + '</td>';
            h += '<td>' + r.customer + '</td>';
            h += '<td>' + r.component + '</td>';
            h += '<td class="mono">' + r.serialNo + '</td>';
            h += '<td>' + r.costCenter + '</td>';
            h += '<td>' + r.rep + '</td>';
            h += '<td class="mono">' + shipStr + '</td>';
            h += '</tr>';
        });

        h += '</tbody></table>';
        h += '<p style="font-size:9px;color:#999;margin-top:12px;">Generated by AUDIT - Compliance Report Generator v2.1 | Bristow Scripts</p>';
        h += '</body></html>';

        // Expose the exporter on the host page so the popup (whose parent is the
        // host page) can call it from the Export button. Must also land on the
        // real page window (unsafeWindow) because the popup's inline
        // parent.__auditExport() resolves against the page, not the GM sandbox.
        if (onExport) {
            try { window.__auditExport = onExport; } catch (e) {}
            try { if (window.unsafeWindow) window.unsafeWindow.__auditExport = onExport; } catch (e) {}
        }
        showPrintout(h, onExport);
    }

    // Embedded (on-page) table: the Work Orders (Shipped) result rendered inside a
    // fixed panel on the CURRENT page so the on-screen count is the single
    // authoritative number. Print stays popup-based; Excel and Close work from
    // the panel directly. All data comes from the Work Orders grid + Bristow
    // Status field history (no Communication Report use).
    function embedWorkOrdersTable(rows, onExport, titlePrefix, withPoDocs) {
        var PANEL_ID = SCRIPT_ID + '-merged-panel';

        var existing = document.getElementById(PANEL_ID);
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

        var dates = getDateRange();
        var dateLabel = '';
        if (dates.start && dates.end) {
            dateLabel = toDisplayDate(dates.start) + ' to ' + toDisplayDate(dates.end);
        } else if (dates.start) {
            dateLabel = 'From ' + toDisplayDate(dates.start);
        } else if (dates.end) {
            dateLabel = 'Up to ' + toDisplayDate(dates.end);
        } else {
            dateLabel = 'All dates';
        }

        if (onExport) {
            try { window.__auditExport = onExport; } catch (e) {}
            try { if (window.unsafeWindow) window.unsafeWindow.__auditExport = onExport; } catch (e) {}
        }

        var hasPoDocs = rows.some(function (r) { return Array.isArray(r.poDocs) && r.poDocs.length > 0; });

        var thead = '<tr>'
            + '<th>#</th><th>Order</th><th>Company</th><th>Order Rep</th>'
            + '<th>Cost Center</th>' + (warrantyColumnActive ? '<th>Warranty</th>' : '')
            + '<th>Office</th><th>Component</th><th>Serial No.</th>'
            + '<th>Shipped Date</th>'
            + (hasPoDocs ? '<th>PO Document</th>' : '')
            + '</tr>';

        var tbody = '';
        rows.forEach(function (r, i) {
            var shipStr = r.shippedDate
                ? (String(r.shippedDate.getDate()).padStart(2, '0') + '-' + MONTHS[r.shippedDate.getMonth()] + '-' + r.shippedDate.getFullYear())
                : '';
            var poDocs = (Array.isArray(r.poDocs) && r.poDocs.length > 0) ? r.poDocs : null;
            if (!poDocs) {
                tbody += '<tr>'
                    + '<td>' + (i + 1) + '</td>'
                    + '<td class="aoc-mono">' + orderLinkHtml(r.order, r.orderId) + '</td>'
                    + '<td>' + String(r.customer || '') + '</td>'
                    + '<td>' + String(r.rep || '') + '</td>'
                    + '<td>' + String(r.costCenter || '') + '</td>'
                    + (warrantyColumnActive ? '<td>' + String(r.warranty || '') + '</td>' : '')
                    + '<td>' + String(r.officeRaw || '') + '</td>'
                    + '<td>' + String(r.component || '') + '</td>'
                    + '<td class="aoc-mono">' + String(r.serialNo || '') + '</td>'
                    + '<td class="aoc-mono">' + shipStr + '</td>'
                    + (hasPoDocs ? '<td></td>' : '')
                    + '</tr>';
                return;
            }
            // Expand: one row per PO document
            for (var j = 0; j < poDocs.length; j++) {
                var isFirst = j === 0;
                var doc = poDocs[j];
                tbody += '<tr>'
                    + '<td>' + (isFirst ? (i + 1) : '') + '</td>'
                    + '<td class="aoc-mono">' + (isFirst ? orderLinkHtml(r.order, r.orderId) : '') + '</td>'
                    + '<td>' + (isFirst ? String(r.customer || '') : '') + '</td>'
                    + '<td>' + (isFirst ? String(r.rep || '') : '') + '</td>'
                    + '<td>' + (isFirst ? String(r.costCenter || '') : '') + '</td>'
                    + (warrantyColumnActive ? '<td>' + (isFirst ? String(r.warranty || '') : '') + '</td>' : '')
                    + '<td>' + (isFirst ? String(r.officeRaw || '') : '') + '</td>'
                    + '<td>' + (isFirst ? String(r.component || '') : '') + '</td>'
                    + '<td class="aoc-mono">' + (isFirst ? String(r.serialNo || '') : '') + '</td>'
                    + '<td class="aoc-mono">' + (isFirst ? shipStr : '') + '</td>'
                    + '<td>' + (doc.documentId
                        ? '<a href="' + location.origin + '/Orders/Orders/Edit?handler=ViewFile&documentId=' + encodeURIComponent(doc.documentId) + '" target="_blank" style="color:#1c5d99;text-decoration:underline;">' + String(doc.name || 'Document') + '</a>'
                        : String(doc.name || 'Document')) + '</td>'
                    + '</tr>';
            }
        });

        var panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483646;background:rgba(0,0,0,0.35);display:flex;align-items:flex-start;justify-content:center;padding:24px;font-family:Arial,sans-serif;';
        panel.innerHTML =
            '<div style="background:#fff;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,0.4);width:98%;max-width:1500px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;">'
            + '<div style="padding:12px 16px;border-bottom:1px solid #ddd;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">'
            + '<div style="font-size:15px;font-weight:600;color:#222;">' + (titlePrefix && titlePrefix !== 'Work Orders' ? titlePrefix + ' ' : '') + 'Work Orders (Shipped) &mdash; Combined&nbsp;&nbsp;' + rows.length + '</div>'
            + '<div style="font-size:12px;color:#667;">Date Range: ' + dateLabel + ' | Generated: ' + new Date().toLocaleDateString() + '</div>'
            + '<div class="audit-panel-tools" style="display:flex;gap:8px;">'
            + '<button id="' + PANEL_ID + '-print" style="background:#378ADD;color:#fff;border:none;padding:7px 14px;border-radius:4px;cursor:pointer;font-size:12px;">Print</button>'
            + (onExport ? '<button id="' + PANEL_ID + '-export" style="background:#27ae60;color:#fff;border:none;padding:7px 14px;border-radius:4px;cursor:pointer;font-size:12px;">Export to Excel</button>' : '')
            + '<button id="' + PANEL_ID + '-close" style="background:#666;color:#fff;border:none;padding:7px 14px;border-radius:4px;cursor:pointer;font-size:12px;">Close</button>'
            + '</div></div>'
            + '<div style="overflow:auto;flex:1;margin-top:8px;">'
            + '<table style="border-collapse:collapse;width:100%;font-size:12px;min-width:1200px;">'
            + '<thead style="position:sticky;top:0;background:#fff;">' + thead + '</thead>'
            + '<tbody>' + tbody + '</tbody>'
            + '</table></div>'
            + '</div>';

        function makeThick(el) {
            el.style.cssText = 'background:#378ADD;color:#fff;padding:7px 10px;text-align:left;border-bottom:1px solid #999;font-weight:600;font-size:12px;white-space:nowrap;';
        }
        var ths = panel.querySelectorAll('thead th');
        for (var k = 0; k < ths.length; k++) makeThick(ths[k]);

        var tds = panel.querySelectorAll('tbody td');
        for (var j = 0; j < tds.length; j++) {
            tds[j].style.cssText = 'padding:5px 10px;border-bottom:1px solid #eee;vertical-align:top;';
            if (tds[j].classList.contains('aoc-mono')) tds[j].style.fontFamily = 'Consolas, monospace';
            if (j % (warrantyColumnActive ? 10 : 9) === 0) tds[j].style.color = '#999';
        }
        var evens = panel.querySelectorAll('tbody tr:nth-child(even)');
        for (var e = 0; e < evens.length; e++) evens[e].style.background = '#f5f8fc';

        document.body.appendChild(panel);

        installAuditSampling(panel, {
            rows: rows,
            title: (titlePrefix && titlePrefix !== 'Work Orders' ? titlePrefix + ' ' : '') + 'Work Orders (Shipped)',
            sampleColumns: [
                { title: 'Order', get: function (r) { return r.order || ''; } },
                { title: 'Company', get: function (r) { return r.customer || ''; } },
                { title: 'Component', get: function (r) { return r.component || ''; } },
                { title: 'Serial No.', get: function (r) { return r.serialNo || ''; } },
                { title: 'Shipped Date', get: function (r) { return r.shippedDate; } }
            ].concat(withPoDocs ? [{
                // PO Document is only relevant to the Subcontract report.
                title: 'PO Document',
                expandable: true,
                getMultiple: function (r) { return (Array.isArray(r.poDocs) ? r.poDocs : []).filter(function (d) { return d && d.documentId; }); },
                getItemLabel: function (d) { return d.name || 'Document'; },
                link: function (d) { return '/Orders/Orders/Edit?handler=ViewFile&documentId=' + encodeURIComponent(d.documentId); }
            }] : []),
            sampleLink: function (r) { return r.orderId ? '/Orders/Orders/Edit?id=' + encodeURIComponent(r.orderId) : ''; }
        });

        setTimeout(function () {
            document.getElementById(PANEL_ID + '-print').onclick = function () {
                generateWorkOrdersPrintout(rows, onExport, titlePrefix);
            };
            var exp = document.getElementById(PANEL_ID + '-export');
            if (exp) exp.onclick = function () {
                try { window.__auditExport(); } catch (err) { showToast('Export failed: ' + err.message, 'warn'); }
            };
            document.getElementById(PANEL_ID + '-close').onclick = function () {
                var p = document.getElementById(PANEL_ID);
                if (p && p.parentNode) p.parentNode.removeChild(p);
            };
        }, 0);
    }

    // Export the shipped rows to a real .xlsx (SheetJS). The workbook holds the
    // FULL dataset (every shipped order, every column) — it is independent of
    // whatever the HTML printout chose to show.
    // For subcontract orders with PO documents, expands rows per document and adds PO Document column.
    function exportWorkOrdersExcel(rows) {
        try {
            if (typeof XLSX === 'undefined') {
                showToast('Excel library (SheetJS) not loaded — check the userscript @require', 'warn');
                return;
            }
            var base = location.origin;
            var hasPoDocs = rows.some(function (r) { return Array.isArray(r.poDocs) && r.poDocs.length > 0; });
            var baseHeaders = ['#', 'Order', 'Company', 'Order Rep', 'Cost Center'];
            if (warrantyColumnActive) baseHeaders.push('Warranty');
            baseHeaders = baseHeaders.concat(['Sub-Contract', 'Office', 'Component', 'Serial No.', 'Manual Used', 'Created At', 'Shipped Date']);
            if (hasPoDocs) baseHeaders = baseHeaders.concat(['PO Document']);

            var aoa = [baseHeaders];
            var hyperlinks = [];

            rows.forEach(function (r, i) {
                var shipped = r.shippedDate ? toDisplayDate(r.shippedDate) : '';
                var created = r.createdAt ? toDisplayDate(r.createdAt) : '';
                var baseRow = [
                    i + 1,
                    r.order,
                    r.customer || '',
                    r.rep || '',
                    r.costCenter || '',
                    warrantyColumnActive ? (r.warranty || '') : [],
                    r.subcontract || '',
                    r.officeRaw || '',
                    r.component || '',
                    r.serialNo || '',
                    r.manualUsed || '',
                    created,
                    shipped
                ];
                var poDocs = (Array.isArray(r.poDocs) && r.poDocs.length > 0) ? r.poDocs : null;
                if (!poDocs) {
                    aoa.push(baseRow.concat(hasPoDocs ? [''] : []));
                    var rn = aoa.length - 1;
                    if (r.orderId) hyperlinks.push({ r: rn, c: 1, target: base + '/Orders/Orders/Edit?id=' + encodeURIComponent(r.orderId), v: r.order });
                    return;
                }
                // Expand: one row per PO document
                for (var j = 0; j < poDocs.length; j++) {
                    var isFirst = j === 0;
                    var doc = poDocs[j];
                    aoa.push([].concat(
                        isFirst ? baseRow : Array(baseRow.length).fill(''),
                        doc.name || 'Document'
                    ));
                    var rn = aoa.length - 1;
                    if (isFirst && r.orderId) hyperlinks.push({ r: rn, c: 1, target: base + '/Orders/Orders/Edit?id=' + encodeURIComponent(r.orderId), v: r.order });
                    if (doc.documentId) hyperlinks.push({ r: rn, c: baseHeaders.length - 1, target: base + '/Orders/Orders/Edit?handler=ViewFile&documentId=' + encodeURIComponent(doc.documentId), v: doc.name });
                }
            });

            var ws = XLSX.utils.aoa_to_sheet(aoa);
            var baseColWidths = [].concat(
                { wch: 6 }, { wch: 18 }, { wch: 40 }, { wch: 20 }, { wch: 14 },
                warrantyColumnActive ? [{ wch: 9 }] : [],
                { wch: 13 }, { wch: 22 }, { wch: 30 }, { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 16 }
            );
            if (hasPoDocs) baseColWidths = baseColWidths.concat([{ wch: 40 }]);
            ws['!cols'] = baseColWidths;
            ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } }) };
            hyperlinks.forEach(function (h) {
                var cellRef = XLSX.utils.encode_cell({ r: h.r, c: h.c });
                var existing = ws[cellRef];
                ws[cellRef] = { t: 's', v: existing && existing.v != null ? existing.v : h.v, l: { Target: h.target } };
            });
            var wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Shipped');
            var fname = 'AUDIT-Shipped-' + new Date().toISOString().slice(0, 10) + '.xlsx';
            XLSX.writeFile(wb, fname);
            showToast('Exported ' + rows.length + ' orders (' + (aoa.length - 1) + ' rows) to ' + fname, 'success');
        } catch (e) {
            console.error('[AUDIT] Excel export failed', e);
            showToast('Excel export failed: ' + e.message, 'warn');
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  REPORT: TIME-SENSITIVE LIBRARY
    // ═════════════════════════════════════════════════════════════════════════

    function naturalCompare(a, b) {
        var re = /(\d+)|(\D+)/g;
        var ax = [], bx = [];
        String(a).replace(re, function (m, n, s) { ax.push([n ? parseInt(n, 10) : Number.MAX_SAFE_INTEGER, s || '']); });
        String(b).replace(re, function (m, n, s) { bx.push([n ? parseInt(n, 10) : Number.MAX_SAFE_INTEGER, s || '']); });
        var i = 0;
        while (i < ax.length && i < bx.length) {
            if (ax[i][0] !== bx[i][0]) return ax[i][0] - bx[i][0];
            var c = String(ax[i][1]).localeCompare(String(bx[i][1]));
            if (c !== 0) return c;
            i++;
        }
        return ax.length - bx.length;
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  RANDOM SAMPLE WORKFLOW (auditor QA)
    //  Any report panel that supplies cfg.sampleColumns gets a "Sample" button:
    //  it picks N unique row numbers with a seeded PRNG (reproducible), highlights
    //  them in the panel, and can emit an Excel / printed "Sample Declaration"
    //  with auditor initials + findings columns for the QA paper trail.
    // ═════════════════════════════════════════════════════════════════════════

    function auditMulberry32(a) {
        return function () {
            a |= 0;
            a = a + 0x6D2B79F5 | 0;
            var t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function auditPickRandomSample(count, total, seed) {
        var idx = [];
        var i;
        for (i = 0; i < total; i++) idx.push(i);
        var rng = auditMulberry32(seed);
        var k = Math.min(count, total);
        var chosen = [];
        for (i = 0; i < k; i++) {
            var j = i + Math.floor(rng() * (total - i));
            if (j !== i) { var tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp; }
            chosen.push(idx[i]);
        }
        chosen.sort(function (a, b) { return a - b; });
        return chosen;
    }

    function auditStripEntities(s) {
        return String(s).replace(/&mdash;/g, '\u2014').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }

    // Uniform sample-declaration cell formatting: dates render dd-MMM-yyyy
    // (no time) whether they arrive as Date objects, ISO/yyyy-mm-dd strings, or
    // the grid's full "Sat Oct 28 2028 00:00:00 GMT-0600 (...)" string form.
    // Numbers and plain text pass through untouched.
    function auditSampleCell(v) {
        if (v == null) return '';
        if (v instanceof Date) return toDisplayDate(v);
        if (typeof v === 'number') return v;
        var s = String(v).trim();
        if (!s) return '';
        var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
        if (iso) {
            var d = formatDateInput(s);
            if (d && !isNaN(d.getTime())) return toDisplayDate(d);
            return s;
        }
        var wk = /^[A-Za-z]{3} [A-Za-z]{3} \d{1,2} \d{4}/.exec(s);
        if (wk) {
            var d2 = new Date(s);
            if (!isNaN(d2.getTime())) return toDisplayDate(d2);
        }
        return s;
    }

    function auditSeedLabel(seed) {
        var d = new Date(seed);
        var ds = String(d.getDate()).padStart(2, '0') + '-' + MONTHS[d.getMonth()] + '-' + d.getFullYear();
        return ds + ' (seed ' + seed + ')';
    }

    function exportAuditSampleDeclarationExcel(cfg, state) {
        try {
            if (typeof XLSX === 'undefined') {
                showToast('Excel library (SheetJS) not loaded \u2014 check the userscript @require', 'warn');
                return;
            }
            var pop = state.filtered ? state.filtered.length : cfg.rows.length;

            var aoa = [];
            aoa.push(['Random Sample Declaration']);
            aoa.push(['Report', auditStripEntities(cfg.title)]);
            aoa.push(['Generated', toDisplayDate(new Date())]);
            aoa.push(['Population', pop]);
            aoa.push(['Sample size', state.indices.length]);
            aoa.push(['Random seed', auditSeedLabel(state.seed)]);
            aoa.push(['Sampled rows', state.indices.map(function (i) { return i + 1; }).join(', ')]);
            aoa.push([]);

            var header = ['#'];
            cfg.sampleColumns.forEach(function (c) { header.push(c.title); });
            header.push('Auditor initials', 'Finding / Notes');
            aoa.push(header);

            // Build expanded rows: for each sampled index, if any column is expandable
            // and returns multiple items, create one row per item. Non-expandable
            // columns only appear on the first row of each group.
            var base = location.origin;
            var expandedRows = []; // each: { baseIdx, seq, rowData[], links[] }
            state.indices.forEach(function (baseIdx, seq) {
                var r = cfg.rows[baseIdx];
                // Determine max expansion count across expandable columns
                var maxCount = 1;
                var multiValues = {};
                cfg.sampleColumns.forEach(function (c, ci) {
                    if (c.expandable && typeof c.getMultiple === 'function') {
                        var arr = c.getMultiple(r) || [];
                        if (arr.length > maxCount) maxCount = arr.length;
                        multiValues[ci] = arr;
                    }
                });
                for (var k = 0; k < maxCount; k++) {
                    var row = [k === 0 ? baseIdx + 1 : ''];
                    var rowLinks = {};
                    cfg.sampleColumns.forEach(function (c, ci) {
                        var val = '';
                        var link = '';
                        if (c.expandable && multiValues[ci]) {
                            var arr = multiValues[ci];
                            if (k < arr.length) {
                                var item = arr[k];
                                val = c.getItemLabel ? c.getItemLabel(item) : String(item);
                                if (typeof c.link === 'function') link = c.link(item);
                            }
                        } else if (k === 0) {
                            val = auditSampleCell(c.get ? c.get(r) : '');
                            if (typeof c.link === 'function') link = c.link(r);
                        }
                        row.push(val);
                        if (link) rowLinks[ci + 1] = { target: base + link, value: val };
                    });
                    row.push('', '');
                    expandedRows.push({ row: row, links: rowLinks });
                }
            });

            expandedRows.forEach(function (er) { aoa.push(er.row); });

            var ws = XLSX.utils.aoa_to_sheet(aoa);
            var colW = [6];
            cfg.sampleColumns.forEach(function () { colW.push(24); });
            colW.push(14, 24);
            ws['!cols'] = colW.map(function (w) { return { wch: w }; });
            // Header row is at index 8 (0-indexed), data starts at index 9
            var headerRowIdx = 8;
            var firstDataRowIdx = headerRowIdx + 1;
            var lastRow = firstDataRowIdx + expandedRows.length - 1;
            ws['!autofilter'] = {
                ref: XLSX.utils.encode_range({
                    s: { r: headerRowIdx, c: 0 },
                    e: { r: lastRow, c: aoa[0].length - 1 }
                })
            };
            ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A' + (headerRowIdx + 1) };

            // Legacy sampleLink (whole-row link on first column)
            if (cfg.sampleLink) {
                var seq = 0;
                expandedRows.forEach(function (er, idx) {
                    if (er.row[0] !== '') { // first row of each group
                        var link = cfg.sampleLink(cfg.rows[state.indices[seq]]);
                        if (link) {
                            var cellRef = XLSX.utils.encode_cell({ r: firstDataRowIdx + idx, c: 1 });
                            var existing = ws[cellRef];
                            ws[cellRef] = { t: 's', v: existing && existing.v != null ? existing.v : '', l: { Target: base + link } };
                        }
                        seq++;
                    }
                });
            }
            // Per-column links (including expanded columns)
            expandedRows.forEach(function (er, idx) {
                Object.keys(er.links).forEach(function (ciStr) {
                    var ci = parseInt(ciStr, 10);
                    var lk = er.links[ciStr];
                    var cellRef = XLSX.utils.encode_cell({ r: firstDataRowIdx + idx, c: ci });
                    var existing = ws[cellRef];
                    ws[cellRef] = { t: 's', v: existing && existing.v != null ? existing.v : lk.value, l: { Target: lk.target } };
                });
            });

            var wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Sample Declaration');
            var fname = 'AUDIT-Sample-Declaration-' + new Date().toISOString().slice(0, 10) + '.xlsx';
            XLSX.writeFile(wb, fname);
            showToast('Sample declaration exported to ' + fname, 'success');
        } catch (e) {
            console.error('[AUDIT] Sample declaration export failed', e);
            showToast('Sample declaration export failed: ' + e.message, 'warn');
        }
    }

    function printAuditSampleDeclaration(cfg, state) {
        var pop = state.filtered ? state.filtered.length : cfg.rows.length;

        var h = '<html><head><title>Random Sample Declaration</title><style>';
        h += 'body{font-family:Arial,sans-serif;font-size:8px;margin:20px}';
        h += 'table{border-collapse:collapse;width:100%;font-size:8px}';
        h += 'th{background:#fff;color:#000;padding:5px 8px;text-align:left;font-size:12px;border-bottom:1px solid #999;font-weight:bold}';
        h += 'td{padding:4px 8px;border-bottom:1px solid #999;vertical-align:top;font-size:8px}';
        h += 'tr:nth-child(even) td{background:#f5f5f5}';
        h += '.mono{font-family:monospace}';
        h += '@media print{button{display:none}}';
        h += '</style></head><body>';
        h += '<h2>Random Sample Declaration</h2>';
        h += '<p style="font-size:10px;">Report: ' + auditStripEntities(cfg.title) + '</p>';
        h += '<p style="font-size:10px;">Generated: ' + toDisplayDate(new Date())
            + ' &mdash; Population: ' + pop
            + ' &mdash; Sample size: ' + state.indices.length + '</p>';
        h += '<p style="font-size:10px;">Random seed: ' + auditSeedLabel(state.seed)
            + ' &mdash; Sampled: #' + state.indices.map(function (i) { return i + 1; }).join(', ') + '</p>';
        h += '<div style="margin-top:8px;margin-bottom:12px;display:flex;gap:8px;">';
        h += '<button onclick="window.print()" style="background:#378ADD;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Print</button>';
        h += '<button onclick="opener.__auditExport()" style="background:#27ae60;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Export to Excel</button>';
        h += '<button onclick="window.close()" style="background:#666;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Close</button>';
        h += '</div>';

        // Build header
        h += '<table><thead><tr><th>#</th>';
        cfg.sampleColumns.forEach(function (c) { h += '<th>' + c.title + '</th>'; });
        h += '<th>Auditor<br/>initials</th><th>Finding / Notes</th>';
        h += '</tr></thead><tbody>';

        // Build rows with expandable column support
        state.indices.forEach(function (baseIdx) {
            var r = cfg.rows[baseIdx];
            // Determine max expansion count across expandable columns
            var maxCount = 1;
            var multiValues = {};
            cfg.sampleColumns.forEach(function (c, ci) {
                if (c.expandable && typeof c.getMultiple === 'function') {
                    var arr = c.getMultiple(r) || [];
                    if (arr.length > maxCount) maxCount = arr.length;
                    multiValues[ci] = arr;
                }
            });
            for (var k = 0; k < maxCount; k++) {
                h += '<tr>';
                h += '<td>' + (k === 0 ? baseIdx + 1 : '') + '</td>';
                cfg.sampleColumns.forEach(function (c, ci) {
                    var val = '';
                    var link = '';
                    if (c.expandable && multiValues[ci]) {
                        var arr = multiValues[ci];
                        if (k < arr.length) {
                            var item = arr[k];
                            val = c.getItemLabel ? c.getItemLabel(item) : String(item);
                            if (typeof c.link === 'function') link = c.link(item);
                        }
                    } else if (k === 0) {
                        val = auditSampleCell(c.get ? c.get(r) : '');
                        if (typeof c.link === 'function') link = c.link(r);
                    }
                    if (link) {
                        h += '<td class="mono"><a href="' + link + '" target="_blank" style="color:#1c5d99;">' + val + '</a></td>';
                    } else {
                        h += '<td class="mono">' + val + '</td>';
                    }
                });
                h += '<td></td><td></td>';
                h += '</tr>';
            }
        });
        h += '</tbody></table>';
        h += '<p style="font-size:9px;color:#999;margin-top:12px;">Generated by AUDIT - Compliance Report Generator | Bristow Scripts</p>';
        h += '</body></html>';
        showPrintout(h, function () { exportAuditSampleDeclarationExcel(cfg, state); });
    }

    function installAuditSampling(panel, cfg) {
        if (!cfg || !cfg.rows || !cfg.rows.length || !cfg.sampleColumns || !cfg.sampleColumns.length) return;
        var toolBar = panel.querySelector('.audit-panel-tools');
        if (!toolBar) return;

        var state = { indices: [], seed: 0, filtered: null };

        function mkBtn(label, color) {
            var b = document.createElement('button');
            b.textContent = label;
            b.style.cssText = 'background:' + color + ';color:#fff;border:none;padding:7px 14px;border-radius:4px;cursor:pointer;font-size:12px;';
            return b;
        }

        function population() {
            return state.filtered ? state.filtered.length : cfg.rows.length;
        }

        function statusText() {
            var pop = population();
            return 'SAMPLE: ' + state.indices.length + ' of ' + pop
                + (state.filtered ? ' (filtered)' : '')
                + ' &mdash; Seed ' + auditSeedLabel(state.seed)
                + ' &mdash; Row(s) #' + state.indices.map(function (i) { return i + 1; }).join(', ');
        }

        function applyHighlight() {
            var tbody = panel.querySelector('table tbody');
            if (!tbody) return;
            var max = cfg.rows.length;
            for (var i = 0; i < tbody.children.length && i < max; i++) {
                var tr = tbody.children[i];
                var on = state.indices.indexOf(i) !== -1;
                tr.style.background = on ? '#fff3cd' : ((i + 1) % 2 === 0 ? '#f5f8fc' : '');
                tr.title = on ? 'Sampled row' : '';
                var c0 = tr.children[0];
                if (c0) c0.style.fontWeight = on ? '700' : '';
            }
        }

        function resetSample() {
            state.indices = [];
            state.seed = 0;
            applyHighlight();
            statusBar.style.display = 'none';
            declBtn.style.display = 'none';
            declPrintBtn.style.display = 'none';
        }

        function updateFilter() {
            var q = box.value.trim().toLowerCase();
            var tbody = panel.querySelector('table tbody');
            if (!tbody) return;
            if (!q) {
                state.filtered = null;
                for (var i = 0; i < cfg.rows.length && i < tbody.children.length; i++) {
                    tbody.children[i].style.display = '';
                }
                countLbl.textContent = '';
            } else {
                var visible = [];
                for (var i = 0; i < cfg.rows.length && i < tbody.children.length; i++) {
                    var txt = tbody.children[i].textContent || '';
                    var match = txt.toLowerCase().indexOf(q) !== -1;
                    tbody.children[i].style.display = match ? '' : 'none';
                    if (match) visible.push(i);
                }
                state.filtered = visible;
                countLbl.textContent = visible.length + ' of ' + cfg.rows.length + ' rows';
            }
            resetSample();
        }

        var inner = panel.firstElementChild;
        var header = inner && inner.firstElementChild;

        // Search bar (always visible): narrows which rows the sample picks from.
        var searchRow = document.createElement('div');
        searchRow.style.cssText = 'padding:6px 16px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #eee;background:#fafafa;';
        var box = document.createElement('input');
        box.type = 'text';
        box.placeholder = 'Search rows \u2014 narrows what the sample picks from';
        box.style.cssText = 'flex:1;padding:5px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;';
        var countLbl = document.createElement('span');
        countLbl.style.cssText = 'font-size:12px;color:#667;white-space:nowrap;';
        searchRow.appendChild(box);
        searchRow.appendChild(countLbl);
        if (header) header.parentNode.insertBefore(searchRow, header.nextSibling);

        // Sample status bar (shown after sampling).
        var statusBar = document.createElement('div');
        statusBar.style.cssText = 'padding:6px 16px;font-size:12px;color:#5b4636;background:#fff8e1;border-bottom:1px solid #e6d9a8;display:none;';
        if (header) inner.insertBefore(statusBar, header.nextSibling.nextSibling ? header.nextSibling.nextSibling : null);

        box.addEventListener('input', updateFilter);

        var sampleBtn = mkBtn('Sample', '#e67e22');
        var declBtn = mkBtn('Declaration (Excel)', '#16a085');
        var declPrintBtn = mkBtn('Declaration (Print)', '#378ADD');
        declBtn.style.display = 'none';
        declPrintBtn.style.display = 'none';

        sampleBtn.onclick = function () {
            var max = population();
            var val = prompt('Select sample size (1 to ' + max + '):', String(Math.min(10, max)));
            if (val == null) return;
            var n = parseInt(String(val).trim(), 10);
            if (isNaN(n) || n < 1) n = 1;
            if (n > max) n = max;
            state.seed = Date.now();
            var picks = auditPickRandomSample(n, max, state.seed);
            state.indices = state.filtered
                ? picks.map(function (p) { return state.filtered[p]; })
                : picks;
            applyHighlight();
            statusBar.innerHTML = statusText();
            statusBar.style.display = '';
            declBtn.style.display = '';
            declPrintBtn.style.display = '';
            showToast('Sample selected: ' + state.indices.length + ' of ' + max + ' row(s)', 'success');
        };

        declBtn.onclick = function () {
            if (state.indices.length) exportAuditSampleDeclarationExcel(cfg, state);
        };
        declPrintBtn.onclick = function () {
            if (state.indices.length) printAuditSampleDeclaration(cfg, state);
        };

        var btnWrap = document.createElement('div');
        btnWrap.style.cssText = 'display:flex;gap:8px;';
        btnWrap.appendChild(sampleBtn);
        btnWrap.appendChild(declBtn);
        btnWrap.appendChild(declPrintBtn);
        toolBar.appendChild(btnWrap);
    }

    // On-page report panel that matches the Work Orders panel styling. cfg:
    // { rows, title, subtitle, columns[], sampleColumns[], sampleLink, rowsHtml(rows)->html, onExport, onPrint }.
    // Print opens the printable popup version; Export writes the Excel file.
    function embedReportPanel(cfg) {
        var PANEL_ID = SCRIPT_ID + '-report-panel';
        var existing = document.getElementById(PANEL_ID);
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

        if (typeof cfg.onExport === 'function') {
            try { window.__auditExport = cfg.onExport; } catch (e) {}
            try { if (window.unsafeWindow) window.unsafeWindow.__auditExport = cfg.onExport; } catch (e) {}
        }

        var thead = '<tr>' + cfg.columns.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>';
        var tbody = cfg.rowsHtml(cfg.rows);

        var panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483646;background:rgba(0,0,0,0.35);display:flex;align-items:flex-start;justify-content:center;padding:24px;font-family:Arial,sans-serif;';
        panel.innerHTML =
            '<div style="background:#fff;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,0.4);width:98%;max-width:1500px;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;">'
            + '<div style="padding:12px 16px;border-bottom:1px solid #ddd;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">'
            + '<div style="font-size:15px;font-weight:600;color:#222;">' + cfg.title + ' &mdash; ' + cfg.rows.length + '</div>'
            + (cfg.subtitle ? '<div style="font-size:12px;color:#667;">' + cfg.subtitle + '</div>' : '')
            + '<div class="audit-panel-tools" style="display:flex;gap:8px;">'
            + (typeof cfg.onPrint === 'function' ? '<button id="' + PANEL_ID + '-print" style="background:#378ADD;color:#fff;border:none;padding:7px 14px;border-radius:4px;cursor:pointer;font-size:12px;">Print</button>' : '')
            + (cfg.onExport ? '<button id="' + PANEL_ID + '-export" style="background:#27ae60;color:#fff;border:none;padding:7px 14px;border-radius:4px;cursor:pointer;font-size:12px;">Export to Excel</button>' : '')
            + (typeof cfg.onVendors === 'function' ? '<button id="' + PANEL_ID + '-vendors" style="background:#8e44ad;color:#fff;border:none;padding:7px 14px;border-radius:4px;cursor:pointer;font-size:12px;">Excluded Vendors' + (cfg.vendorExcludedCount ? ' (' + cfg.vendorExcludedCount + ')' : '') + '</button>' : '')
            + '<button id="' + PANEL_ID + '-close" style="background:#666;color:#fff;border:none;padding:7px 14px;border-radius:4px;cursor:pointer;font-size:12px;">Close</button>'
            + '</div></div>'
            + '<div style="overflow:auto;flex:1;margin-top:8px;">'
            + '<table style="border-collapse:collapse;width:100%;font-size:12px;min-width:1000px;">'
            + '<thead style="position:sticky;top:0;background:#fff;">' + thead + '</thead>'
            + '<tbody>' + tbody + '</tbody>'
            + '</table></div>'
            + '</div>';

        var ths = panel.querySelectorAll('thead th');
        for (var k = 0; k < ths.length; k++) {
            ths[k].style.cssText = 'background:#378ADD;color:#fff;padding:7px 10px;text-align:left;border-bottom:1px solid #999;font-weight:600;font-size:12px;white-space:nowrap;';
        }
        var tds = panel.querySelectorAll('tbody td');
        for (var j = 0; j < tds.length; j++) {
            tds[j].style.cssText = 'padding:5px 10px;border-bottom:1px solid #eee;vertical-align:top;';
            if (tds[j].classList.contains('aoc-mono')) tds[j].style.fontFamily = 'Consolas, monospace';
        }
        var evens = panel.querySelectorAll('tbody tr:nth-child(even)');
        for (var e = 0; e < evens.length; e++) evens[e].style.background = '#f5f8fc';

        document.body.appendChild(panel);

        installAuditSampling(panel, cfg);

        setTimeout(function () {
            var printBtn = document.getElementById(PANEL_ID + '-print');
            if (printBtn) printBtn.onclick = function () { if (cfg.onPrint) cfg.onPrint(); };
            var exp = document.getElementById(PANEL_ID + '-export');
            if (exp) exp.onclick = function () {
                try { window.__auditExport(); } catch (err) { showToast('Export failed: ' + err.message, 'warn'); }
            };
            document.getElementById(PANEL_ID + '-close').onclick = function () {
                var p = document.getElementById(PANEL_ID);
                if (p && p.parentNode) p.parentNode.removeChild(p);
            };
            var vendBtn = document.getElementById(PANEL_ID + '-vendors');
            if (vendBtn && typeof cfg.onVendors === 'function') {
                vendBtn.onclick = function () { cfg.onVendors(panel); };
            }
        }, 0);
    }

    function generateTimeSensitiveLibPrintout(rows, onExport) {
        var now = new Date();
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

        function fmtDate(s) {
            if (!s) return '';
            var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (m) {
                var d = new Date(+m[1], +m[2] - 1, +m[3]);
                return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
            }
            var d2 = new Date(s);
            if (!isNaN(d2.getTime())) {
                return String(d2.getDate()).padStart(2, '0') + '-' + months[d2.getMonth()] + '-' + d2.getFullYear();
            }
            return s;
        }

        var dateLabel = String(now.getDate()).padStart(2, '0') + '-' + months[now.getMonth()] + '-' + now.getFullYear();

        var h = '<html><head><title>Time-Sensitive Library</title><style>';
        h += 'body{font-family:Arial,sans-serif;font-size:8px;margin:20px}';
        h += 'table{border-collapse:collapse;width:100%;font-size:8px}';
        h += 'th{background:#fff;color:#000;padding:5px 8px;text-align:left;font-size:12px;border-bottom:1px solid #999;font-weight:bold}';
        h += 'td{padding:4px 8px;border-bottom:1px solid #999;vertical-align:top;font-size:8px}';
        h += 'tr:nth-child(even) td{background:#f5f5f5}';
        h += '.mono{font-family:monospace}';
        h += '.exp-soon{color:#c0392b;font-weight:bold}';
        h += '@media print{button{display:none}}';
        h += '</style></head><body>';
        h += '<h2>Time-Sensitive Library &mdash; ' + rows.length + '</h2>';
        h += '<p style="font-size:10px;color:#666;">Generated: ' + dateLabel + '</p>';
        h += '<div style="margin-top:8px;margin-bottom:12px;display:flex;gap:8px;">';
        h += '<button onclick="window.print()" style="background:#378ADD;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Print</button>';
        if (onExport) {
            h += '<button onclick="opener.__auditExport()" style="background:#27ae60;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Export to Excel</button>';
        }
        h += '<button onclick="window.close()" style="background:#666;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Close</button>';
        h += '</div>';
        h += '<table><thead><tr>';
        h += '<th>#</th><th>Manual #</th><th>Location</th><th>Status</th><th>Expiration Date</th>';
        h += '</tr></thead><tbody>';

        rows.forEach(function (r, i) {
            var expStr = fmtDate(r.expirationDate);
            var expClass = '';
            if (r.expirationDate) {
                var expDate = new Date(r.expirationDate);
                if (!isNaN(expDate.getTime())) {
                    var diffDays = Math.ceil((expDate - now) / 86400000);
                    if (diffDays <= 30) expClass = ' class="exp-soon"';
                }
            }

            h += '<tr>';
            h += '<td>' + (i + 1) + '</td>';
            h += '<td>' + r.name + '</td>';
            h += '<td>' + r.location + '</td>';
            h += '<td>Time Sensitive</td>';
            h += '<td' + expClass + '>' + expStr + '</td>';
            h += '</tr>';
        });

        h += '</tbody></table>';
        h += '<p style="font-size:9px;color:#999;margin-top:12px;">Generated by AUDIT - Compliance Report Generator v2.1 | Bristow Scripts</p>';
        h += '</body></html>';

        if (onExport) {
            try { window.__auditExport = onExport; } catch (e) {}
            try { if (window.unsafeWindow) window.unsafeWindow.__auditExport = onExport; } catch (e) {}
        }
        showPrintout(h, onExport);
    }

    function exportTimeSensitiveExcel(rows) {
        try {
            if (typeof XLSX === 'undefined') {
                showToast('Excel library (SheetJS) not loaded — check the userscript @require', 'warn');
                return;
            }
            var base = location.origin;
            function fmtDate(s) {
                if (!s) return '';
                var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
                if (m) {
                    var d = new Date(+m[1], +m[2] - 1, +m[3]);
                    return String(d.getDate()).padStart(2, '0') + '-' + MONTHS[d.getMonth()] + '-' + d.getFullYear();
                }
                var d2 = new Date(s);
                if (!isNaN(d2.getTime())) {
                    return String(d2.getDate()).padStart(2, '0') + '-' + MONTHS[d2.getMonth()] + '-' + d2.getFullYear();
                }
                return s;
            }
            var aoa = [['#', 'Manual #', 'Location', 'Status', 'Expiration Date']];
            rows.forEach(function (r, i) {
                aoa.push([
                    i + 1,
                    r.name,
                    r.location,
                    'Time Sensitive',
                    fmtDate(r.expirationDate)
                ]);
            });
            var ws = XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = [
                { wch: 6 }, { wch: 60 }, { wch: 22 }, { wch: 16 }, { wch: 16 }
            ];
            ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } }) };
            for (var i = 0; i < rows.length; i++) {
                var did = rows[i].id;
                if (!did) continue;
                var cell = XLSX.utils.encode_cell({ r: i + 1, c: 1 });
                ws[cell] = { t: 's', v: rows[i].name, l: { Target: base + '/Catalog/Documentations/ViewDocumentation?id=' + encodeURIComponent(did) } };
            }
            var wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'TimeSensitive');
            var fname = 'AUDIT-TimeSensitive-' + new Date().toISOString().slice(0, 10) + '.xlsx';
            XLSX.writeFile(wb, fname);
            showToast('Exported ' + rows.length + ' docs to ' + fname, 'success');
        } catch (e) {
            console.error('[AUDIT] Time-Sensitive export failed', e);
            showToast('Time-Sensitive export failed: ' + e.message, 'warn');
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  REPORT: TOOLS (ALL)
    // ═════════════════════════════════════════════════════════════════════════

    // Returns the value after "LABEL:" on its own line inside the structured
    // AeroTools Description text (e.g. Category: Primary, Owner: Bristow).
    function parseDescField(desc, label) {
        if (!desc) return '';
        var re = new RegExp('(?:^|\\n)\\s*' + label + '\\s*:\\s*([^\\n]*)', 'i');
        var m = String(desc).match(re);
        return m ? m[1].trim() : '';
    }

    // Fallback location extraction: when a tool's Location field is blank, pull
    // the value after "Location:" / "LOCATION:" from the name/description, if
    // present. Stops the capture at the next known label (Owner/MFG) or a line
    // break, so trailing tags aren't swallowed into the location string.
    function parseLocationFromName(name) {
        if (!name) return '';
        var m = String(name).match(/location\s*:\s*([^\n]*)/i);
        if (!m) return '';
        var loc = m[1].trim();
        loc = loc.split(/\s+(?:Owner|MFG)\s*:/i)[0].trim();
        loc = loc.replace(/[.\s]+$/, '');
        return loc;
    }

    // Sort locations numerically first (by their dash-separated numeric parts),
    // then alphabetically. Rows with no location sort last.
    function locationCompare(a, b) {
        var la = String(a || '').trim();
        var lb = String(b || '').trim();

        var isNumA = /^\d/.test(la);
        var isNumB = /^\d/.test(lb);
        if (isNumA !== isNumB) return isNumA ? -1 : 1;

        function parts(s) {
            return s.split(/-|\s+/).filter(function (p) { return p !== ''; });
        }

        function toNum(p) {
            var n = parseFloat(p);
            return isFinite(n) ? n : null;
        }

        var pa = parts(la);
        var pb = parts(lb);
        var len = Math.max(pa.length, pb.length);
        for (var i = 0; i < len; i++) {
            var x = pa[i] || '';
            var y = pb[i] || '';
            var xa = toNum(x);
            var ya = toNum(y);
            if (xa !== null && ya !== null) {
                if (xa !== ya) return xa - ya;
                // do not compare leading-zero text here; move on
            } else {
                var sc = naturalCompare(x, y);
                if (sc !== 0) return sc;
            }
        }
        return naturalCompare(la, lb);
    }

    // Classify a location for report ordering: 0 = rack (letter + 4-digit
    // number like A0107), 1 = bin (letter + 1-3 digit number like R56, UP200),
    // 2 = everything else (blank, N/A, bare words, etc.). The leading
    // alphanumeric token decides, so 'J0509 OS #11' still ranks as a rack.
    function locRank(loc) {
        var s = String(loc || '').trim().toUpperCase();
        var m = /^([A-Za-z]+)(\d+)/.exec(s);
        if (m) return m[2].length === 4 ? 0 : 1;
        return 2;
    }

    // Fetch each tool's edit page when the grid/description had no location, so
    // the printable sheet still shows where each tool lives.
    function enrichAeroToolsLocations(rows) {
        var missing = rows.filter(function (r) {
            return r.id && !r.location;
        });
        if (missing.length === 0) {
            return Promise.resolve();
        }
        showProgress('Pulling missing locations (' + missing.length + ')...');

        var chain = Promise.resolve();
        var resolved = 0;

        missing.forEach(function (row) {
            chain = chain.then(function () {
                return new Promise(function (resolve) {
                    var xhr = new XMLHttpRequest();
                    xhr.open('GET', '/Catalog/AeroTools/EditAeroTool?id=' + encodeURIComponent(row.id), true);
                    xhr.timeout = 8000;
                    xhr.onreadystatechange = function () {
                        if (xhr.readyState !== 4) return;
                        if (xhr.status === 200) {
                            var el = document.implementation &&
                                new DOMParser().parseFromString(xhr.responseText, 'text/html');
                            var loc = '';
                            if (el) {
                                var node = el.getElementById('aero-location') || el.getElementById('Tool_Location');
                                if (node && node.value) loc = node.value.trim();
                            }
                            if (!loc) {
                                var m = xhr.responseText.match(/id=["']Tool_Location["'][^>]*value=["']([^"']*)["']/i);
                                if (m) loc = m[1].trim();
                            }
                            if (loc) row.location = loc;
                        }
                        resolved++;
                        if (resolved >= missing.length) hideProgress();
                        resolve();
                    };
                    xhr.onerror = function () { resolved++; hideProgress(); resolve(); };
                    xhr.onabort = function () { resolved++; hideProgress(); resolve(); };
                    xhr.ontimeout = function () { resolved++; hideProgress(); resolve(); };
                    xhr.send();
                });
            });
        });

        return chain;
    }

    function runAeroTools() {
        var g = getKendoGrid('grid');
        if (!g) {
            showToast('AeroTools grid not found', 'warn');
            return;
        }

        showProgress('Loading AeroTools...');

        // ── Read the whole dataset (server often ignores Kendo filters), then
        //    keep only In Service tools as the source of truth. ──
        var origPageSize = g.dataSource.pageSize();
        g.dataSource.pageSize(99999);

        try {
            g.dataSource.filter([{ field: 'IsEnabled', operator: 'eq', value: true }]);
        } catch (e) {
            try { g.dataSource.filter([]); } catch (e2) {}
        }

        var onDone = function () {
            var all = g.dataSource.data();
            var rows = [];

            for (var i = 0; i < all.length; i++) {
                var r = all[i].toJSON ? all[i].toJSON() : all[i];
                if (r.IsEnabled !== true) continue;

                var desc = String(r.Description || '').replace(/<br\s*\/?>/gi, '\n');
                var name = parseDescField(desc, 'Description');
                if (!name) {
                    var firstLine = desc.split('\n')[0] || '';
                    name = firstLine.replace(/^Description\s*:\s*/i, '').trim();
                }

                rows.push({
                    id: r.Id || '',
                    toolNumber: r.ToolNumber || '',
                    category: parseDescField(desc, 'Category'),
                    description: name,
                    location: r.Location || parseDescField(desc, 'Location') || parseLocationFromName(desc) || '',
                    owner: parseDescField(desc, 'Owner'),
                    calDueDate: r.CalDueDate != null ? r.CalDueDate : ''
                });
            }

            try { g.dataSource.pageSize(origPageSize); } catch (e) {}

            if (rows.length === 0) {
                hideProgress();
                showToast('No tools are currently In Service', 'info');
                return;
            }

            hideProgress();
            enrichAeroToolsLocations(rows).then(function () {
                rows.sort(function (a, b) {
                    var lc = locationCompare(a.location, b.location);
                    return lc !== 0 ? lc : naturalCompare(a.toolNumber, b.toolNumber);
                });
                embedReportPanel({
                    rows: rows,
                    title: 'Tools (All) &mdash; In Service',
                    subtitle: 'Generated: ' + new Date().toLocaleDateString(),
                    columns: ['#', 'Tool Number', 'Category', 'Description', 'Location', 'Owner', 'Calibration Due'],
                    sampleColumns: [
                        { title: 'Tool Number', get: function (r) { return r.toolNumber || ''; } },
                        { title: 'Category', get: function (r) { return r.category || ''; } },
                        { title: 'Location', get: function (r) { return r.location || ''; } },
                        { title: 'Calibration Due', get: function (r) { return r.calDueDate || ''; } }
                    ],
                    sampleLink: function (r) { return r.id ? '/Catalog/AeroTools/ViewAeroTool?id=' + encodeURIComponent(r.id) : ''; },
                    rowsHtml: function (rs) {
                        function fmtCal(s) {
                            if (!s) return '';
                            var text = (s instanceof Date ? String(s.getFullYear()) + '-' + String(s.getMonth() + 1).padStart(2, '0') + '-' + String(s.getDate()).padStart(2, '0') : String(s));
                            var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
                            if (m) {
                                var mo = parseInt(m[2], 10) - 1;
                                if (mo >= 0 && mo < 12) {
                                    return String(parseInt(m[3], 10)).padStart(2, '0') + '-' + MONTHS[mo] + '-' + m[1];
                                }
                            }
                            var d = new Date(text);
                            if (!isNaN(d.getTime())) {
                                return String(d.getDate()).padStart(2, '0') + '-' + MONTHS[d.getMonth()] + '-' + d.getFullYear();
                            }
                            return text;
                        }
                        var out = '';
                        rs.forEach(function (r, i) {
                            out += '<tr>'
                                + '<td>' + (i + 1) + '</td>'
                                + '<td class="aoc-mono">' + (r.toolNumber || '') + '</td>'
                                + '<td>' + (r.category || '') + '</td>'
                                + '<td>' + (r.description || '') + '</td>'
                                + '<td>' + (r.location || '') + '</td>'
                                + '<td>' + (r.owner || '') + '</td>'
                                + '<td class="aoc-mono">' + fmtCal(r.calDueDate) + '</td>'
                                + '</tr>';
                        });
                        return out;
                    },
                    onExport: function () { exportToolsExcel(rows); },
                    onPrint: function () {
                        generateAeroToolsPrintout(rows, function () { exportToolsExcel(rows); });
                    }
                });
            });
        };

        var cleanup = null;
        var done = false;

        var handler = function () {
            if (done) return;
            done = true;
            g.dataSource.unbind('requestEnd', handler);
            if (cleanup) { clearTimeout(cleanup); cleanup = null; }
            setTimeout(onDone, 300);
        };
        g.dataSource.bind('requestEnd', handler);

        if (typeof searchGrid === 'function') {
            searchGrid();
        } else {
            g.dataSource.read();
        }

        cleanup = setTimeout(function () {
            if (done) return;
            done = true;
            g.dataSource.unbind('requestEnd', handler);
            onDone();
        }, 15000);
    }

    function generateAeroToolsPrintout(rows, onExport) {
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var now = new Date();
        var dateLabel = String(now.getDate()).padStart(2, '0') + '-' + months[now.getMonth()] + '-' + now.getFullYear();

        function fmtCal(s) {
            if (!s) return '';
            var text = (s instanceof Date ? String(s.getFullYear()) + '-' + String(s.getMonth() + 1).padStart(2, '0') + '-' + String(s.getDate()).padStart(2, '0') : String(s));
            var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
            if (m) {
                var mo = parseInt(m[2], 10) - 1;
                if (mo >= 0 && mo < 12) {
                    return String(parseInt(m[3], 10)).padStart(2, '0') + '-' + months[mo] + '-' + m[1];
                }
            }
            var d = new Date(text);
            if (!isNaN(d.getTime())) {
                return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
            }
            return text;
        }

        var h = '<html><head><title>Tools (All)</title><style>';
        h += 'body{font-family:Arial,sans-serif;font-size:8px;margin:20px}';
        h += 'table{border-collapse:collapse;width:100%;font-size:8px}';
        h += 'th{background:#fff;color:#000;padding:5px 8px;text-align:left;font-size:12px;border-bottom:1px solid #999;font-weight:bold}';
        h += 'td{padding:4px 8px;border-bottom:1px solid #999;vertical-align:top;font-size:8px}';
        h += 'tr:nth-child(even) td{background:#f5f5f5}';
        h += '.mono{font-family:monospace}';
        h += '.tick{font-family:DejaVu Sans,Segoe UI Symbol,Arial;font-size:12px;}';
        h += '@media print{button{display:none}}';
        h += '</style></head><body>';
        h += '<h2>Tools (All) &mdash; In Service &mdash; ' + rows.length + '</h2>';
        h += '<p style="font-size:10px;color:#666;">Generated: ' + dateLabel + '</p>';
        h += '<div style="margin-top:8px;margin-bottom:12px;display:flex;gap:8px;">';
        h += '<button onclick="window.print()" style="background:#378ADD;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Print</button>';
        if (onExport) {
            h += '<button onclick="opener.__auditExport()" style="background:#27ae60;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Export to Excel</button>';
        }
        h += '<button onclick="window.close()" style="background:#666;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Close</button>';
        h += '</div>';
        h += '<table><thead><tr>';
        h += '<th>#</th><th>Tool Number</th><th>Category</th><th>Description</th><th>Location</th><th>Owner</th><th>Calibration Due</th>';
        h += '</tr></thead><tbody>';

        rows.forEach(function (r, i) {
            h += '<tr>';
            h += '<td>' + (i + 1) + '</td>';
            h += '<td class="mono">' + r.toolNumber + '</td>';
            h += '<td>' + r.category + '</td>';
            h += '<td>' + r.description + '</td>';
            h += '<td class="mono">' + r.location + '</td>';
            h += '<td>' + r.owner + '</td>';
            h += '<td class="mono">' + fmtCal(r.calDueDate) + '</td>';
            h += '</tr>';
        });

        h += '</tbody></table>';
        h += '<p style="font-size:9px;color:#999;margin-top:12px;">Generated by AUDIT - Compliance Report Generator v2.1 | Bristow Scripts</p>';
        h += '</body></html>';

        if (onExport) {
            try { window.__auditExport = onExport; } catch (e) {}
            try { if (window.unsafeWindow) window.unsafeWindow.__auditExport = onExport; } catch (e) {}
        }
        showPrintout(h, onExport);
    }

    function exportToolsExcel(rows) {
        try {
            if (typeof XLSX === 'undefined') {
                showToast('Excel library (SheetJS) not loaded — check the userscript @require', 'warn');
                return;
            }
            var base = location.origin;
            function fmtCal(s) {
                if (!s) return '';
                var text = (s instanceof Date ? String(s.getFullYear()) + '-' + String(s.getMonth() + 1).padStart(2, '0') + '-' + String(s.getDate()).padStart(2, '0') : String(s));
                var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
                if (m) {
                    var mo = parseInt(m[2], 10) - 1;
                    if (mo >= 0 && mo < 12) return String(parseInt(m[3], 10)).padStart(2, '0') + '-' + MONTHS[mo] + '-' + m[1];
                }
                var d = new Date(text);
                if (!isNaN(d.getTime())) return String(d.getDate()).padStart(2, '0') + '-' + MONTHS[d.getMonth()] + '-' + d.getFullYear();
                return text;
            }
            var aoa = [['#', 'Tool Number', 'Category', 'Description', 'Location', 'Owner', 'Calibration Due']];
            rows.forEach(function (r, i) {
                aoa.push([
                    i + 1,
                    r.toolNumber,
                    r.category,
                    r.description,
                    r.location,
                    r.owner,
                    fmtCal(r.calDueDate)
                ]);
            });
            var ws = XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = [
                { wch: 6 }, { wch: 12 }, { wch: 14 }, { wch: 60 }, { wch: 22 }, { wch: 14 }, { wch: 16 }
            ];
            ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } }) };
            for (var i = 0; i < rows.length; i++) {
                var tid = rows[i].id;
                if (!tid) continue;
                var cell = XLSX.utils.encode_cell({ r: i + 1, c: 1 });
                ws[cell] = { t: 's', v: rows[i].toolNumber, l: { Target: base + '/Catalog/AeroTools/ViewAeroTool?id=' + encodeURIComponent(tid) } };
            }
            var wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Tools');
            var fname = 'AUDIT-Tools-' + new Date().toISOString().slice(0, 10) + '.xlsx';
            XLSX.writeFile(wb, fname);
            showToast('Exported ' + rows.length + ' tools to ' + fname, 'success');
        } catch (e) {
            console.error('[AUDIT] Tools export failed', e);
            showToast('Tools export failed: ' + e.message, 'warn');
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  INVENTORY REPORT (/Inventory)
    // ═════════════════════════════════════════════════════════════════════════

    // Pulls a tag value from a part's PartTags array by type name.
    function partTagValue(part, tagTypeName, fallback) {
        try {
            if (part && part.PartTags && part.PartTags.length) {
                for (var i = 0; i < part.PartTags.length; i++) {
                    if (String(part.PartTags[i].TagTypeName) === tagTypeName && part.PartTags[i].TagValue != null) {
                        var v = String(part.PartTags[i].TagValue);
                        return /&nbsp;|^\s*$/.test(v) ? (fallback || '') : v;
                    }
                }
            }
        } catch (e) {}
        return fallback || '';
    }

    // Reads the whole /Inventory #partGrid dataset. AeroTools-style: bump the
    // page size so one read returns everything, honoring the page's current
    // office-select / hide-Empty filters via the grid's own read transport.
    // ── Inventory PO / EXP enrichment ──────────────────────────────────────
    // The master parts payload (/Inventory?handler=Parts) carries no
    // group-identifier text; that lives only in each part's value-group rows
    // (/Inventory?PartId=<id>&showUnprocessedQuantity=false). We fetch those
    // once per part and pull out every distinct "PO <n>" and expiry date so the
    // report can show comma-joined PO and EXP columns. Capped, because a full
    // ~80k-row inventory would otherwise mean 80k requests.
    var INV_ENRICH_MAX = 20000;
    var INV_ENRICH_PARALLEL = 20;
    var invVgStats = null;
    var vgWarned = 0;
    function warnOnce(msg) { if (vgWarned < 5) { vgWarned++; console.warn('[AUDIT] ' + msg); } }

    function invYear(y) {
        y = String(y);
        return y.length === 2 ? '20' + y : y;
    }

    // Normalizes one date token to dd-MMM-yyyy, or MMM-yyyy when it has no day.
    // Accepts dd-Mmm-yyyy / dd/Mmm/yyyy / dd Mmm yyyy / Mmm dd yyyy /
    // MM/yyyy / MM/yy (2-digit year -> 20xx).
    function normalizeExpDate(token) {
        token = String(token || '').replace(/\s+/g, ' ').trim();
        if (!token) return '';
        var m, mo;
        m = token.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3,9})[-\/ ](\d{2,4})$/);
        if (m) {
            mo = MONTHS_MAP[String(m[2]).slice(0, 3).toUpperCase()];
            if (mo != null) return String(m[1]).padStart(2, '0') + '-' + MONTHS[mo] + '-' + invYear(m[3]);
        }
        m = token.match(/^([A-Za-z]{3,9})[-\/ ](\d{1,2})[-\/ ,]+(\d{2,4})$/);
        if (m) {
            mo = MONTHS_MAP[String(m[1]).slice(0, 3).toUpperCase()];
            if (mo != null) return String(m[2]).padStart(2, '0') + '-' + MONTHS[mo] + '-' + invYear(m[3]);
        }
        // Non-anchored so "EXP 06/27" falls through here if "EXP" was not a month.
        m = token.match(/(\d{1,2})[-\/](\d{4})/);
        if (m) {
            mo = Number(m[1]);
            if (mo >= 1 && mo <= 12) return MONTHS[mo - 1] + '-' + m[2];
        }
        m = token.match(/(\d{1,2})[-\/](\d{2})/);
        if (m) {
            mo = Number(m[1]);
            if (mo >= 1 && mo <= 12) return MONTHS[mo - 1] + '-20' + m[2];
        }
        return '';
    }

    // Month names are spelled out so a stray "40" from a PO number cannot pair
    // with the literal "EXP" marker and be mistaken for a date.
    var INV_DATE_TOKEN = /\b\d{1,2}[-\/ ](?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Za-z]*[-\/ ]\d{2,4}\b|\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Za-z]*[-\/ ]\d{1,2}[-\/ ,]+\d{2,4}\b|\b\d{1,2}[-\/]\d{4}\b|\b\d{1,2}[-\/]\d{2}\b/gi;

    // Splits one GroupIdentifier string into distinct PO numbers and expiry
    // dates. Dates are only read from segments that mention "EXP" or that
    // immediately follow such a segment ("PO 1 | EXP | 31/SEP/2033").
    function parseGroupIdentifierText(text) {
        var pos = [], exps = [];
        var segs = String(text || '').split('|');
        segs.forEach(function (seg, idx) {
            var re = /\bPO\.?\s*[:#]?\s*(\d{3,})\b/gi;
            var pm;
            while ((pm = re.exec(seg)) !== null) {
                if (pos.indexOf(pm[1]) === -1) pos.push(pm[1]);
            }
            if (!/exp/i.test(seg) && !(idx > 0 && /exp/i.test(segs[idx - 1]))) return;
            var tokens = String(seg).match(INV_DATE_TOKEN) || [];
            tokens.forEach(function (t) {
                var d = normalizeExpDate(t);
                if (d && exps.indexOf(d) === -1) exps.push(d);
            });
        });
        return { po: pos, exp: exps };
    }

    function fetchPartGroupIdentifiers(row) {
        return new Promise(function (resolve) {
            var done = false;
            var finish = function () { if (!done) { done = true; resolve(); } };
            var attempts = 0;
            function attempt() {
                attempts++;
                var xhr = new XMLHttpRequest();
                try {
                    xhr.open('GET', '/Inventory?PartId=' + encodeURIComponent(row.id) + '&handler=ValueGroups&showUnprocessedQuantity=false', true);
                    xhr.timeout = 10000;
                    xhr.onreadystatechange = function () {
                        if (xhr.readyState !== 4) return;
                        if (xhr.status === 200) {
                            var body = null;
                            try {
                                var j = JSON.parse(xhr.responseText);
                                body = Array.isArray(j) ? j : (j && (j.Data || j.data || j.Items || j.items)) || null;
                            } catch (e) { body = null; }
                            if (Array.isArray(body)) {
                                var pos = [], exps = [];
                                body.forEach(function (vg) {
                                    var gtext = vg && (vg.GroupIdentifier || vg.groupIdentifier || vg['Group Identifier'] || vg.GroupIdentifiers || '');
                                    var p = parseGroupIdentifierText(gtext);
                                    p.po.forEach(function (v) { if (pos.indexOf(v) === -1) pos.push(v); });
                                    p.exp.forEach(function (v) { if (exps.indexOf(v) === -1) exps.push(v); });
                                });
                                if (invVgStats) invVgStats.ok++;
                                if (pos.length) { row.po = pos.join(', '); if (invVgStats) invVgStats.po++; }
                                if (exps.length) { row.exp = exps.join(', '); if (invVgStats) invVgStats.exp++; }
                                finish();
                            } else if (attempts < 2) {
                                attempt();
                            } else {
                                warnOnce('vg unexpected body id=' + row.id + ' len=' + (xhr.responseText ? xhr.responseText.length : 0) + ' sample=' + (xhr.responseText || '').slice(0, 160));
                                finish();
                            }
                            return;
                        }
                        if (attempts < 2) { attempt(); } else { warnOnce('vg HTTP ' + xhr.status + ' for ' + row.id + ' after retry'); finish(); }
                    };
                    xhr.onerror = function () { if (attempts < 2) { attempt(); } else { warnOnce('vg network error for ' + row.id + ' after retry'); finish(); } };
                    xhr.ontimeout = function () { if (attempts < 2) { attempt(); } else { warnOnce('vg timeout for ' + row.id + ' after retry'); finish(); } };
                    xhr.onabort = finish;
                    xhr.send();
                } catch (e) { warnOnce('vg exception for ' + row.id); finish(); }
            }
            attempt();
        });
    }

    function enrichInventoryPartGroups(rows) {
        var targets = (rows || []).filter(function (r) { return !!r.id; });
        if (targets.length === 0) return Promise.resolve();
        if (targets.length > INV_ENRICH_MAX) {
            console.warn('[AUDIT] inventory PO/EXP enrichment skipped: ' + targets.length + ' parts > cap ' + INV_ENRICH_MAX);
            showToast('PO/EXP columns skipped for ' + targets.length + ' parts - narrow with Group Identifier Search', 'info');
            return Promise.resolve();
        }
        showProgress('Reading PO / EXP (' + targets.length + ' parts)...');
        invVgStats = { parts: targets.length, ok: 0, po: 0, exp: 0 };
        var idx = 0;
        function step() {
            if (idx >= targets.length) return Promise.resolve();
            var slice = targets.slice(idx, idx + INV_ENRICH_PARALLEL);
            idx += INV_ENRICH_PARALLEL;
            return Promise.all(slice.map(fetchPartGroupIdentifiers)).then(step);
        }
        return step().then(function () {
            hideProgress();
            var s = invVgStats;
            console.log('[AUDIT] vg done parts=' + s.parts + ' fetched=' + s.ok + ' withPO=' + s.po + ' withEXP=' + s.exp);
            if (s.ok === 0) showToast('PO/EXP: 0 value-group responses (see console for [AUDIT] vg lines)', 'warn');
            else showToast('PO/EXP: fetched ' + s.ok + ' of ' + s.parts + ' parts - ' + s.po + ' PO, ' + s.exp + ' EXP', 'info');
        }, function () {
            hideProgress();
        });
    }

    // ── Time-Sensitive Library report ──
    function runTimeSensitiveLib() {
        var g = getKendoGrid('grid');
        if (!g) {
            showToast('Documentations grid not found', 'warn');
            return;
        }

        showProgress('Loading Time-Sensitive Library...');

        var origPageSize = g.dataSource.pageSize();
        g.dataSource.pageSize(99999);

        // ── The server handler only filters via its own gridFilterData()/wRelated,
        //    so Kendo filters never reach it. Read everything, then filter
        //    client-side for DocStatus = 4 (Time Sensitive). ──
        g.dataSource.filter([]);

        var onDone = function () {
            var all = g.dataSource.data();
            var rows = [];

            for (var i = 0; i < all.length; i++) {
                var r = all[i].toJSON ? all[i].toJSON() : all[i];
                if (r.DocStatus !== 4) continue;
                var loc = r.Location || '';
                if (!String(loc).trim()) {
                    loc = parseLocationFromName(r.Name || '');
                }
                rows.push({
                    id: r.Id || '',
                    name: r.Name || '',
                    location: loc,
                    expirationDate: r.ExpirationDate || ''
                });
            }

            try { g.dataSource.pageSize(origPageSize); } catch (e) {}

            if (rows.length === 0) {
                hideProgress();
                showToast('No time-sensitive documents found', 'info');
                return;
            }

            hideProgress();
            rows.sort(function (a, b) {
                return naturalCompare(a.name, b.name);
            });
            embedReportPanel({
                rows: rows,
                title: 'Time-Sensitive Library',
                subtitle: 'Generated: ' + new Date().toLocaleDateString(),
                columns: ['#', 'Manual #', 'Location', 'Status', 'Expiration Date'],
                sampleColumns: [
                    { title: 'Manual #', get: function (r) { return r.name || ''; } },
                    { title: 'Location', get: function (r) { return r.location || ''; } },
                    { title: 'Expiration Date', get: function (r) { return r.expirationDate || ''; } }
                ],
                sampleLink: function (r) { return r.id ? '/Catalog/Documentations/ViewDocumentation?id=' + encodeURIComponent(r.id) : ''; },
                rowsHtml: function (rs) {
                    function fmtDate(s) {
                        if (!s) return '';
                        var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
                        if (m) {
                            var d = new Date(+m[1], +m[2] - 1, +m[3]);
                            return String(d.getDate()).padStart(2, '0') + '-' + MONTHS[d.getMonth()] + '-' + d.getFullYear();
                        }
                        var d2 = new Date(s);
                        if (!isNaN(d2.getTime())) {
                            return String(d2.getDate()).padStart(2, '0') + '-' + MONTHS[d2.getMonth()] + '-' + d2.getFullYear();
                        }
                        return s;
                    }
                    var out = '';
                    rs.forEach(function (r, i) {
                        out += '<tr>'
                            + '<td>' + (i + 1) + '</td>'
                            + '<td class="aoc-mono">' + (r.name || '') + '</td>'
                            + '<td>' + (r.location || '') + '</td>'
                            + '<td>Time Sensitive</td>'
                            + '<td class="aoc-mono">' + fmtDate(r.expirationDate) + '</td>'
                            + '</tr>';
                    });
                    return out;
                },
                onExport: function () { exportTimeSensitiveExcel(rows); },
                onPrint: function () {
                    generateTimeSensitiveLibPrintout(rows, function () { exportTimeSensitiveExcel(rows); });
                }
            });
        };

        var cleanup = null;
        var done = false;

        var handler = function () {
            if (done) return;
            done = true;
            g.dataSource.unbind('requestEnd', handler);
            if (cleanup) { clearTimeout(cleanup); cleanup = null; }
            setTimeout(onDone, 300);
        };
        g.dataSource.bind('requestEnd', handler);

        if (typeof searchGrid === 'function') {
            searchGrid();
        } else {
            g.dataSource.read();
        }

        cleanup = setTimeout(function () {
            if (done) return;
            done = true;
            g.dataSource.unbind('requestEnd', handler);
            onDone();
        }, 15000);
    }

    function runInventory(inStockOnly, skipLocationFilter) {
        var g = getKendoGrid('partGrid');
        if (!g) {
            showToast('Inventory grid not found (are you on /Inventory?)', 'warn');
            return;
        }

        showProgress('Loading Inventory...');

        // Fetch through a DETACHED DataSource that mirrors the live grid's
        // transport + current filters, so ~80k rows are never rendered into the
        // DOM (binding the real grid to that many rows freezes the page).
        var src = g.dataSource;
        var ds = null;
        var cloneError = null;
        try {
            var DSClass = (src && src.constructor) || (window.kendo && window.kendo.data && window.kendo.data.DataSource);
            if (DSClass && src && src.options) {
                var base = src.options.transport || {};
                var opts = {
                    transport: {
                        read: {
                            url: base.read && base.read.url !== undefined ? base.read.url : src.options.url,
                            data: base.read && typeof base.read.data === 'function' ? base.read.data : undefined
                        }
                    },
                    schema: src.options.schema,
                    filter: src.filter(),
                    sort: src.sort(),
                    group: src.group(),
                    aggregate: src.aggregate(),
                    page: 1,
                    pageSize: 999999,
                    serverPaging: true,
                    serverSorting: true,
                    serverFiltering: true,
                    serverGrouping: true,
                    serverAggregates: true
                };
                ds = new DSClass(opts);
                console.log('[AUDIT] inventory clone DS created. url=' + (opts.transport.read.url || '') + ' pageSize=' + ds.pageSize());
            }
        } catch (e) {
            cloneError = e;
            console.error('[AUDIT] inventory DS clone failed; falling back to grid view', e);
        }

        var onDone = function () {
            var rows = [];
            var all = null;
            if (ds && typeof ds.data === 'function') {
                all = ds.data();
                console.log('[AUDIT] inventory clone path; rows=' + (all ? all.length : 0));
            } else {
                all = g.dataSource.view() && g.dataSource.view().length ? g.dataSource.view() : g.dataSource.data();
                console.log('[AUDIT] inventory grid-view fallback' + (cloneError ? ' (error: ' + (cloneError && cloneError.message) + ')' : ''));
            }
            var tally = { fetched: all ? all.length : 0, noId: 0, disabled: 0, category: 0, location: 0, qtyZero: 0, kept: 0 };
            for (var i = 0; i < (all ? all.length : 0); i++) {
                var r = (all[i] && all[i].toJSON) ? all[i].toJSON() : all[i];
                if (!r || !r.Id) { tally.noId++; continue; }
                // Only enabled parts by default; the grid already filters IsEnabled.
                if (r.IsEnabled === false) { tally.disabled++; continue; }
                // Exclude unwanted categories (COR, Tool, shop supplies, etc.).
                if (EXCLUDED_CATEGORIES[String(r.Category || '').trim().toUpperCase()]) { tally.category++; continue; }

                var partNumber = partTagValue(r, 'Part Number', '') || r.PrefixedPartNumber || '';
                var location = partTagValue(r, 'Location', '');
                var condition = partTagValue(r, 'Condition', '');
                if (!skipLocationFilter) {
                    var locKey = String(location || '').trim().toUpperCase();
                    var badExact = locKey === '' || locKey === '0' || locKey === 'N/A' || locKey === 'UP' || locKey === 'SC' || locKey === '10-13-1';
                    if (badExact || /^AA/.test(locKey) || /^C[A-Z]/.test(locKey) || /^SC\d+/.test(locKey) || /^UP\d+/.test(locKey)) { tally.location++; continue; }
                    if (locKey.indexOf('PT') === 0 || locKey.indexOf('Z') === 0) { tally.location++; continue; }
                }

                if (inStockOnly || skipLocationFilter) {
                    var qty = Number(r.StockedTotal) || 0;
                    if (qty <= 0) { tally.qtyZero++; continue; }
                }

                rows.push({
                    id: r.Id,
                    partNumber: partNumber,
                    category: String(r.Category || ''),
                    description: String(r.Description || ''),
                    location: location,
                    condition: condition,
                    marketValue: r.MarketValue,
                    incoming: Number(r.IncomingTotal) || 0,
                    claimed: Number(r.PresoldTotal) || 0,
                    stocked: Number(r.StockedTotal) || 0,
                    reserved: Number(r.ReservedTotal) || 0,
                    picked: Number(r.PickedTotal) || 0,
                    note: String(r.Note || '')
                });
            }
            tally.kept = rows.length;
            console.log('[AUDIT] inventory tally fetched=' + tally.fetched + ' noId=' + tally.noId + ' disabled=' + tally.disabled +
                ' category=' + tally.category + ' location=' + tally.location + ' qtyZero=' + tally.qtyZero + ' kept=' + tally.kept);

            rows.sort(function (a, b) {
                var la = String(a.location || '').trim().toUpperCase();
                var lb = String(b.location || '').trim().toUpperCase();
                var ra = locRank(la);
                var rb = locRank(lb);
                if (ra !== rb) return ra - rb;
                var lc = naturalCompare(la, lb);
                if (lc !== 0) return lc;
                return naturalCompare(String(a.partNumber || '').toLowerCase(), String(b.partNumber || '').toLowerCase());
            });

            if (rows.length === 0) {
                hideProgress();
                showToast('No inventory' + (inStockOnly ? ' in stock' : '') + ' found', 'info');
                return;
            }

            var title = inStockOnly ? 'Inventory (In Stock)' : 'Inventory (All)';
            var render = function () {
                hideProgress();
                embedReportPanel({
                    rows: rows,
                    title: title,
                    subtitle: 'Generated: ' + new Date().toLocaleDateString(),
                    columns: ['#', 'Part Number', 'Description', 'Location', 'PO', 'EXP', 'Quantity'],
                    sampleColumns: [
                        { title: 'Part Number', get: function (r) { return r.partNumber || ''; } },
                        { title: 'Description', get: function (r) { return r.description || ''; } },
                        { title: 'Location', get: function (r) { return r.location || ''; } },
                        { title: 'PO', get: function (r) { return r.po || ''; } },
                        { title: 'EXP', get: function (r) { return r.exp || ''; } },
                        { title: 'Quantity', get: function (r) { return r.stocked || ''; } }
                    ],
                    rowsHtml: function (rs) {
                        var out = '';
                        rs.forEach(function (r, i) {
                            out += '<tr>'
                                + '<td>' + (i + 1) + '</td>'
                                + '<td class="aoc-mono">' + (r.partNumber || '') + '</td>'
                                + '<td>' + (r.description || '') + '</td>'
                                + '<td class="aoc-mono">' + (r.location || '') + '</td>'
                                + '<td class="aoc-mono">' + (r.po || '') + '</td>'
                                + '<td class="aoc-mono">' + (r.exp || '') + '</td>'
                                + '<td>' + (r.stocked || '') + '</td>'
                                + '</tr>';
                        });
                        return out;
                    },
                    onExport: function () { exportInventoryExcel(rows, title); },
                    onPrint: function () {
                        generateInventoryPrintout(rows, title, function () { exportInventoryExcel(rows, title); });
                    }
                });
            };
            enrichInventoryPartGroups(rows).then(render, render);
        };

        if (!ds) { onDone(); return; }

        var done = false;
        var cleanup = null;
        var inFlight = false;
        var startedAt = 0;
        try {
            ds.bind('requestStart', function () {
                inFlight = true;
                startedAt = Date.now();
                console.log('[AUDIT] clone requestStart; url=', JSON.stringify(ds.options && ds.options.transport && ds.options.transport.read && ds.options.transport.read.url), 'filter=', JSON.stringify((ds.filter && ds.filter()) || null));
            });
        } catch (e) {}
        try {
            ds.bind('requestError', function (e) {
                inFlight = false;
                var xhr = e && e.xhr;
                console.warn('[AUDIT] clone requestError; status=', xhr && xhr.status, 'statusText=', xhr && xhr.statusText, 'body=', xhr && xhr.responseText ? String(xhr.responseText).slice(0, 500) : '(none)');
            });
        } catch (e) {}
        var handler = function () {
            if (done) return;
            done = true;
            inFlight = false;
            try { ds.unbind('requestEnd', handler); } catch (e) {}
            if (cleanup) { clearTimeout(cleanup); cleanup = null; }
            console.log('[AUDIT] clone requestEnd; rows=', (ds && ds.data) ? ds.data().length : '?', 'total=', (ds && ds.total) ? ds.total() : '?');
            setTimeout(onDone, 300);
        };

        try { ds.bind('requestEnd', handler); } catch (e) {}
        try { ds.read(); } catch (e) { onDone(); }

        // The full /Inventory?handler=Parts payload can take a while to
        // serialize (tens of thousands of rows). Never conclude "no inventory"
        // while a request is still in flight: keep polling every 15s up to 5
        // minutes; only wrap up early once the request errored out or never
        // started (e.g. transport blowup that fires neither event).
        var watcher = function () {
            if (done) return;
            if (inFlight && Date.now() - startedAt < 5 * 60 * 1000) {
                cleanup = setTimeout(watcher, 15000);
                return;
            }
            done = true;
            cleanup = null;
            try { ds.unbind('requestEnd', handler); } catch (e) {}
            onDone();
        };
        cleanup = setTimeout(watcher, 15000);
    }

    // ── Purchase Orders report ──
    // Fetches from /Orders/PoList?handler=POs via XHR (remote — runs from any page).
    // Supports date range filtering on CompletedDate/CreatedAt, office filter, and vendor filter.
    function runPurchaseOrders() {
        showProgress('Loading Purchase Orders...');
        poRemoveModeOn = false;
        poRemovedMgrOpen = false;
        poRestoreScrollTop = null;

        // Fetch all Purchase Orders via the grid's handler endpoint
        fetchPurchaseOrdersGridData()
            .then(function (res) {
                if (res.error) throw new Error('Failed to fetch Purchase Orders grid: ' + res.error);
                var all = res.rows || [];
                var dates = getDateRange();

                var endOfDay = null;
                if (dates.end) {
                    endOfDay = new Date(dates.end);
                    endOfDay.setHours(23, 59, 59, 999);
                }
                var startT = dates.start ? dates.start.getTime() : null;
                var endT = endOfDay ? endOfDay.getTime() : null;

                // PO date-only per user: office selection is intentionally ignored so
                // all offices' purchase orders come back within the date range.

                var rows = [];
                for (var i = 0; i < all.length; i++) {
                    var r = all[i];
                    if (!r || !r.Id) continue;

                    var po = r.PrimaryOffice != null ? String(r.PrimaryOffice) : '';
                    if (startT !== null || endT !== null) {
                        var d = parseDateValue(r.CompletedDate != null ? r.CompletedDate : r.CreatedAt);
                        if (!d) continue;
                        var t = d.getTime();
                        if (startT !== null && t < startT) continue;
                        if (endT !== null && t > endT) continue;
                    }

                    // Field names mirror the real /Orders/PoList grid data-fields
                    // (Company, Subtotal, CreatedAt, SubmittedAt, Status, OrderNumber,
                    // OrderType, OrderRep, Project) with legacy fallbacks for safety.
                    var vendor = r.Company != null ? String(r.Company) : (r.Vendor != null ? (r.Vendor.Name || String(r.Vendor)) : '');
                    // Status clones carry only the flat numeric code (Status="3"); the
                    // grid's own filter list maps code->text (3=Complete). Resolve via
                    // that map, preferring any real text field when present.
                    var status = r.POStatusName || r.StatusName;
                    if (status == null || String(status) === '') status = poOptionText(r.Status, getPOStatusOptions());
                    status = String(status || '');
                    // PO report is a Completed-only list (user requirement) — the status
                    // falls through either the grid filter map (3=Complete) or a real
                    // text field; drop anything that isn't textually "Complete" so no
                    // Open/Submitted/Partial rows leak into the report.
                    if (status !== 'Complete') continue;
                    var poNumber = r.PONumber || r.PoNumber || '';
                    var createdAt = (r.CompletedDate != null ? r.CompletedDate : (r.CreatedAt != null ? r.CreatedAt : r.CreatedDate)) || '';
                    var submittedAt = r.SubmittedAt || '';
                    var total = Number(r.Subtotal) || Number(r.TotalAmount) || Number(r.Total) || 0;
                    var orderNumber = r.OrderNumber != null ? String(r.OrderNumber) : '';
                    // Order id: the grid row carries the Order entity guid under a few
                    // possible shapes; most rows have it flat as OrderId. This row-level
                    // value is a fallback — the cache enrichment below replaces it with
                    // the guid parsed from the EditPO page when available.
                    var orderId = '';
                    if (r.OrderId != null && String(r.OrderId).trim() !== '') orderId = String(r.OrderId);
                    else if (r.Order != null && r.Order.Id != null && String(r.Order.Id).trim() !== '') orderId = String(r.Order.Id);
                    else if (r.POHeader != null && r.POHeader.OrderId != null && String(r.POHeader.OrderId).trim() !== '') orderId = String(r.POHeader.OrderId);
                    // OrderType clones often carry only the flat numeric code
                    // (OrderType="1"); the grid's own filter list maps code->text
                    // (0=Customer,1=Stock,2=Transfer,3=Return). Resolve via that map
                    // first (it passes non-code strings through unchanged), and only
                    // fall back to a text field when the code left it empty.
                    var orderType = poOptionText(r.OrderType, getPOOrderTypeOptions());
                    if (orderType == null || String(orderType) === '') orderType = r.OrderTypeName || r.OrderTypeText;
                    orderType = String(orderType || '');
                    var orderRep = r.OrderRep != null ? String(r.OrderRep) : '';
                    var project = r.Project != null ? String(r.Project) : '';

                    rows.push({
                        id: r.Id,
                        poNumber: poNumber,
                        vendor: vendor,
                        status: status,
                        createdAt: createdAt,
                        submittedAt: submittedAt,
                        total: total,
                        orderNumber: orderNumber,
                        orderId: orderId,
                        orderType: orderType,
                        orderRep: orderRep,
                        project: project,
                        officeRaw: po
                    });
                }

                if (rows.length === 0) {
                    hideProgress();
                    showToast('No purchase orders found for the selected filters', 'info');
                    return;
                }

                // Continue with subcontract check, document fetch, etc.
                continuePurchaseOrdersProcessing(rows);
            })
            .catch(function (e) {
                hideProgress();
                console.error('[AUDIT] Purchase Orders failed', e);
                showToast('Purchase Orders failed: ' + (e && e.message ? e.message : e), 'error');
            });
    }

        function continuePurchaseOrdersProcessing(rows) {
            // Sub-contract exclusion...
            var poIdsToCheck = rows.map(function (r) { return r.id; });
            showProgress('Checking subcontract POs (' + poIdsToCheck.length + ')...');
            fetchPOSubcontractBatch(poIdsToCheck).then(function (posc) {
                // Attach cached extras from the same EditPO fetch.
                rows.forEach(function (r) {
                    var e = posc[r.id];
                    if (e && typeof e === 'object') {
                        if (e.completedDate) r.completedDate = e.completedDate;
                        if (e.part) r.part = e.part;
                        if (e.orderId) r.orderId = e.orderId;
                    }
                });

                var filtered = rows.filter(function (r) {
                    var e = posc[r.id];
                    return !(r.id && e && typeof e === 'object' && e.subcontract === true);
                });

                if (filtered.length === 0) {
                    hideProgress();
                    showToast('No purchase orders found for the selected filters', 'info');
                    return;
                }
                rows = filtered;

                // Newest first by Completed Date (from the EditPO enrichment above),
                // falling back to Created At; rows with no date sink to the bottom,
                // ties broken by PO number.
                function poSortTime(r) {
                    var d = parseDateValue(r.completedDate) || parseDateValue(r.createdAt);
                    return d ? d.getTime() : -Infinity;
                }
                rows.sort(function (a, b) {
                    var ta = poSortTime(a), tb = poSortTime(b);
                    if (ta !== tb) return ta < tb ? 1 : -1;
                    return String(a.poNumber || '').localeCompare(String(b.poNumber || ''));
                });
                hideProgress();

                // Document column (OS- orders)
                var docOrderIds = [];
                var docSeen = {};
                rows.forEach(function (r) {
                    if (r.orderId && r.orderNumber && r.orderNumber.indexOf('OS-') === 0 && !docSeen[r.orderId]) {
                        docSeen[r.orderId] = true;
                        docOrderIds.push(r.orderId);
                    }
                });

                function finalizePOReport(docCache) {
                    rows.forEach(function (r) {
                        var dc = (r.orderId && docCache && docCache[r.orderId]) ? docCache[r.orderId] : null;
                        r.documents = (dc && Array.isArray(dc.docs)) ? dc.docs : [];
                    });

                    // Vendor exclusion...
                    var excluded = getExcludedVendors();
                    var excludedByVendor = {};
                    for (var ei = 0; ei < excluded.length; ei++) {
                        excludedByVendor[String(excluded[ei]).trim().toLowerCase()] = true;
                    }
                    var kept = [];
                    var droppedVendors = [];
                    for (var ri = 0; ri < rows.length; ri++) {
                        var vendName = String(rows[ri].vendor || '').trim();
                        if (vendName && excludedByVendor[vendName.toLowerCase()]) {
                            if (droppedVendors.indexOf(vendName) === -1) droppedVendors.push(vendName);
                            continue;
                        }
                        kept.push(rows[ri]);
                    }
                    if (droppedVendors.length) {
                        console.log('[AUDIT] dropped ' + droppedVendors.length + ' vendor(s) from PO report by request (' + droppedVendors.join(', ') + ')');
                    }
                    // Saved row-removal rules (red X): applied after vendor exclusion.
                    var poPool = kept;
                    var rowRules = getPORowExclusions();
                    var ruleHidden = 0;
                    if (rowRules.length) {
                        kept = poPool.filter(function (r) {
                            for (var qi = 0; qi < rowRules.length; qi++) {
                                if (poRuleMatches(rowRules[qi], r)) { ruleHidden++; return false; }
                            }
                            return true;
                        });
                        console.log('[AUDIT] ' + ruleHidden + ' PO(s) hidden by ' + rowRules.length + ' row-removal rule(s)');
                    }
                    var reportRows = kept;

                    // Distinct vendor names + PO counts for vendor manager
                    var vendorStats = (function () {
                        var map = {};
                        for (var vi = 0; vi < rows.length; vi++) {
                            var vn = String(rows[vi].vendor || '').trim();
                            if (!vn) continue;
                            var vl = vn.toLowerCase();
                            if (!map[vl]) map[vl] = { name: vn, count: 0 };
                            map[vl].count++;
                        }
                        var out = [];
                        for (var vk in map) { if (map.hasOwnProperty(vk)) out.push(map[vk]); }
                        return out;
                    })();

                    hideProgress();
                    embedReportPanel({
                        rows: reportRows,
                        title: 'Purchase Orders' + ((droppedVendors.length || ruleHidden) ? ' (' + [droppedVendors.length ? 'vendors excluded: ' + droppedVendors.length : '', ruleHidden ? 'rows removed: ' + ruleHidden : ''].filter(Boolean).join(', ') + ')' : ''),
                        subtitle: 'Generated: ' + new Date().toLocaleDateString(),
                        vendorExcludedCount: excluded.length,
                        onVendors: function (panel) {
                            toggleVendorManager(panel, function () {
                                finalizePOReport(docCache);
                            }, vendorStats);
                        },
                        columns: ['#', 'Order', 'PO Number', 'Vendor', 'Part', 'Document', 'Subtotal', 'Created At', 'Submitted At', 'Completed Date', 'Status', 'Order Type', 'Order Rep', 'Project'],
                        sampleColumns: [
                            { title: 'Order', get: function (r) { return r.orderNumber || ''; }, link: function (r) { return r.orderId ? '/Orders/Orders/Edit?id=' + encodeURIComponent(r.orderId) : ''; } },
                            { title: 'PO Number', get: function (r) { return r.poNumber || ''; }, link: function (r) { return r.id ? '/Orders/Orders/EditPO?id=' + encodeURIComponent(r.id) : ''; } },
                            { title: 'Vendor', get: function (r) { return r.vendor || ''; } },
                            { title: 'Part', get: function (r) { return r.part || ''; } },
                            {
                                title: 'Document', get: function (r) { return docNames(r.documents); }, link: function (r) {
                                    var docs = (Array.isArray(r.documents) ? r.documents : []).filter(function (d) { return d && d.documentId; });
                                    return docs.length ? '/Orders/Orders/Edit?handler=ViewFile&documentId=' + encodeURIComponent(docs[0].documentId) : '';
                                }
                            },
                            { title: 'Completed Date', get: function (r) { return r.completedDate || ''; } }
                        ],
                        rowsHtml: function (rs) {
                            var out = '';
                            rs.forEach(function (r, i) {
                                var createdStr = '';
                                var cd = parseDateValue(r.createdAt);
                                if (cd) createdStr = toDisplayDate(cd);
                                var submittedStr = '';
                                var sd = parseDateValue(r.submittedAt);
                                if (sd) submittedStr = toDisplayDate(sd);
                                var completedStr = '';
                                var cdd = parseDateValue(r.completedDate);
                                if (cdd) completedStr = toDisplayDate(cdd);
                                else if (r.completedDate) completedStr = String(r.completedDate);
                                out += '<tr>'
                                    + '<td>' + (i + 1) + '</td>'
                                    + '<td>' + orderLinkHtml(r.orderNumber, r.orderId) + '</td>'
                                    + '<td class="aoc-mono"><a href="/Orders/Orders/EditPO?id=' + encodeURIComponent(r.id || '') + '" target="_blank" style="color:#1c5d99;text-decoration:underline;">' + (r.poNumber || '') + '</a></td>'
                                    + '<td>' + (r.vendor || '') + '</td>'
                                    + '<td>' + (r.part || '') + '</td>'
                                    + '<td>' + docLinksHtml(r.documents) + '</td>'
                                    + '<td class="aoc-mono">' + formatMoney(r.total) + '</td>'
                                    + '<td class="aoc-mono">' + createdStr + '</td>'
                                    + '<td class="aoc-mono">' + submittedStr + '</td>'
                                    + '<td class="aoc-mono">' + completedStr + '</td>'
                                    + '<td>' + (r.status || '') + '</td>'
                                    + '<td>' + (r.orderType || '') + '</td>'
                                    + '<td>' + (r.orderRep || '') + '</td>'
                                    + '<td>' + (r.project || '') + '</td>'
                                    + '</tr>';
                            });
                            return out;
                        },
                        onExport: function () { exportPurchaseOrdersExcel(reportRows); },
                        onPrint: function () { generatePurchaseOrdersPrintout(reportRows, function () { exportPurchaseOrdersExcel(reportRows); }); }
                    });
                    installPORowRemoval({
                        pool: poPool,
                        rows: reportRows,
                        hidden: ruleHidden,
                        rerender: function () { finalizePOReport(docCache); }
                    });
                }

                if (docOrderIds.length === 0) {
                    finalizePOReport(getOrderDocCache());
                } else {
                    showProgress('Fetching order documents (' + docOrderIds.length + ' orders)...');
                    fetchOrderDocsBatch(docOrderIds).then(finalizePOReport);
                }
            }).catch(function (e) {
                hideProgress();
                console.error('[AUDIT] Purchase Orders failed', e);
                showToast('Purchase Orders failed: ' + (e && e.message ? e.message : e), 'error');
            });
        }

    function exportPurchaseOrdersExcel(rows) {
        try {
            if (typeof XLSX === 'undefined') {
                showToast('Excel library (SheetJS) not loaded', 'warn');
                return;
            }
            var base = location.origin;

            // An xlsx cell can only carry ONE hyperlink target, so a PO with
            // several documents can't get multiple working links in one
            // "Document" cell. Instead of adding columns, a PO with N
            // documents gets N rows here: only the FIRST row carries the
            // Order/PO Number/Vendor/Part/Subtotal/etc — every other row for
            // that PO shows just the Document cell and nothing else, so it
            // reads as "this line has another document" instead of looking
            // like a separate line item. Cells aren't merged: Excel refuses
            // to sort a range containing differently-sized merged cells, and
            // this sheet has autofilter/sort on.
            var aoa = [['#', 'Order', 'PO Number', 'Vendor', 'Part', 'Document', 'Subtotal', 'Created At', 'Submitted At', 'Completed Date', 'Status', 'Order Type', 'Order Rep', 'Project']];
            var hyperlinks = [];
            rows.forEach(function (r, i) {
                var createdStr = '';
                var cd = parseDateValue(r.createdAt);
                if (cd) createdStr = toDisplayDate(cd);
                var submittedStr = '';
                var sd = parseDateValue(r.submittedAt);
                if (sd) submittedStr = toDisplayDate(sd);
                var completedStr = '';
                var cdd = parseDateValue(r.completedDate);
                if (cdd) completedStr = toDisplayDate(cdd);
                var docs = (Array.isArray(r.documents) ? r.documents : []).filter(function (d) { return d && d.documentId; });
                var docCount = docs.length || 1;
                for (var j = 0; j < docCount; j++) {
                    var isFirst = j === 0;
                    aoa.push([
                        isFirst ? i + 1 : '',
                        isFirst ? r.orderNumber : '',
                        isFirst ? r.poNumber : '',
                        isFirst ? r.vendor : '',
                        isFirst ? r.part : '',
                        docs[j] ? String(docs[j].name || 'Document') : '',
                        isFirst ? r.total : '',
                        isFirst ? createdStr : '',
                        isFirst ? submittedStr : '',
                        isFirst ? completedStr : '',
                        isFirst ? r.status : '',
                        isFirst ? r.orderType : '',
                        isFirst ? r.orderRep : '',
                        isFirst ? r.project : ''
                    ]);
                    var rn = aoa.length - 1;
                    if (isFirst && r.orderId) hyperlinks.push({ r: rn, c: 1, target: base + '/Orders/Orders/Edit?id=' + encodeURIComponent(r.orderId), v: r.orderNumber });
                    if (isFirst && r.id) hyperlinks.push({ r: rn, c: 2, target: base + '/Orders/Orders/EditPO?id=' + encodeURIComponent(r.id), v: r.poNumber });
                    if (docs[j]) hyperlinks.push({ r: rn, c: 5, target: base + '/Orders/Orders/Edit?handler=ViewFile&documentId=' + encodeURIComponent(docs[j].documentId), v: String(docs[j].name || 'Document') });
                }
            });
            var ws = XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = [
                { wch: 6 }, { wch: 20 }, { wch: 20 }, { wch: 40 }, { wch: 40 }, { wch: 40 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 18 }
            ];
            ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } }) };
            hyperlinks.forEach(function (h) {
                var cellRef = XLSX.utils.encode_cell({ r: h.r, c: h.c });
                ws[cellRef] = { t: 's', v: h.v, l: { Target: h.target } };
            });
            var wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Purchase Orders');
            var fname = 'AUDIT-PurchaseOrders-' + new Date().toISOString().slice(0, 10) + '.xlsx';
            XLSX.writeFile(wb, fname);
            showToast('Exported ' + rows.length + ' purchase orders (' + (aoa.length - 1) + ' rows) to ' + fname, 'success');
        } catch (e) {
            console.error('[AUDIT] Purchase Orders export failed', e);
            showToast('Purchase Orders export failed: ' + e.message, 'warn');
        }
    }

    function generatePurchaseOrdersPrintout(rows, onExport) {
        var now = new Date();
        var dateLabel = String(now.getDate()).padStart(2, '0') + '-' + MONTHS[now.getMonth()] + '-' + now.getFullYear();

        var h = '<html><head><title>Purchase Orders</title><style>';
        h += 'body{font-family:Arial,sans-serif;font-size:8px;margin:20px}';
        h += 'table{border-collapse:collapse;width:100%;font-size:8px}';
        h += 'th{background:#fff;color:#000;padding:5px 8px;text-align:left;font-size:12px;border-bottom:1px solid #999;font-weight:bold}';
        h += 'td{padding:4px 8px;border-bottom:1px solid #999;vertical-align:top;font-size:8px}';
        h += 'tr:nth-child(even) td{background:#f5f5f5}';
        h += '.mono{font-family:monospace}';
        h += '@media print{button{display:none}}';
        h += '</style></head><body>';
        h += '<h2>Purchase Orders &mdash; ' + rows.length + '</h2>';
        h += '<p style="font-size:10px;color:#666;">Generated: ' + dateLabel + '</p>';
        h += '<div style="margin-top:8px;margin-bottom:12px;display:flex;gap:8px;">';
        h += '<button onclick="window.print()" style="background:#378ADD;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Print</button>';
        if (onExport) {
            h += '<button onclick="opener.__auditExport()" style="background:#27ae60;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Export to Excel</button>';
        }
        h += '<button onclick="window.close()" style="background:#666;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Close</button>';
        h += '</div>';
        h += '<table><thead><tr>';
        h += '<th>#</th><th>Order</th><th>PO Number</th><th>Vendor</th><th>Part</th><th>Document</th><th>Subtotal</th><th>Created At</th><th>Submitted At</th><th>Completed Date</th><th>Status</th><th>Order Type</th><th>Order Rep</th><th>Project</th>';
        h += '</tr></thead><tbody>';
        rows.forEach(function (r, i) {
            var createdStr = '';
            var cd = parseDateValue(r.createdAt);
            if (cd) createdStr = String(cd.getDate()).padStart(2, '0') + '-' + MONTHS[cd.getMonth()] + '-' + cd.getFullYear();
            var submittedStr = '';
            var sd = parseDateValue(r.submittedAt);
            if (sd) submittedStr = String(sd.getDate()).padStart(2, '0') + '-' + MONTHS[sd.getMonth()] + '-' + sd.getFullYear();
            var completedStr = '';
            var cdd = parseDateValue(r.completedDate);
            if (cdd) completedStr = String(cdd.getDate()).padStart(2, '0') + '-' + MONTHS[cdd.getMonth()] + '-' + cdd.getFullYear();
            h += '<tr>';
            h += '<td>' + (i + 1) + '</td>';
            h += '<td>' + orderLinkHtml(r.orderNumber, r.orderId) + '</td>';
            h += '<td class="mono"><a href="/Orders/Orders/EditPO?id=' + encodeURIComponent(r.id || '') + '" style="color:#1c5d99;">' + (r.poNumber || '') + '</a></td>';
            h += '<td>' + (r.vendor || '') + '</td>';
            h += '<td>' + (r.part || '') + '</td>';
            h += '<td>' + docLinksHtml(r.documents) + '</td>';
            h += '<td class="mono">' + formatMoney(r.total) + '</td>';
            h += '<td class="mono">' + createdStr + '</td>';
            h += '<td class="mono">' + submittedStr + '</td>';
            h += '<td class="mono">' + completedStr + '</td>';
            h += '<td>' + (r.status || '') + '</td>';
            h += '<td>' + (r.orderType || '') + '</td>';
            h += '<td>' + (r.orderRep || '') + '</td>';
            h += '<td>' + (r.project || '') + '</td>';
            h += '</tr>';
        });
        h += '</tbody></table>';
        h += '<p style="font-size:9px;color:#999;margin-top:12px;">Generated by AUDIT - Compliance Report Generator | Bristow Scripts</p>';
        h += '</body></html>';

        if (onExport) {
            try { window.__auditExport = onExport; } catch (e) {}
            try { if (window.unsafeWindow) window.unsafeWindow.__auditExport = onExport; } catch (e) {}
        }
        showPrintout(h, onExport);
    }

    // ── Manual Usage report ──
    // Reuses the Work Orders shipped-order pipeline (YEG/BRI + completed +
    // Shipped status + shipped date in range) but OMITS every other filter
    // (category, office, rep, front-end staff, controlled goods). For each
    // shipped order it fetches the aero-documents grid handler
    // (/Orders/Orders/Edit?orderId=<guid>&handler=AeroDocuments) and reads the
    // manual number of the "Selected" document (the green checkmark), which is
    // the first up-to-4 digits of its Name.
    // The StatusHistory scan caches per-order shipped dates but leaves orders
    // UNcached when the server hiccups (transient 5xx/timeout) — which is why a
    // first run can fall back to the order's Created date. This retries exactly
    // those still-uncached orders once, in parallel, persisting any recovered
    // date so the report self-heals on the same run. Orders cached-null (really
    // no recoverable shipped transition) are left alone.
    function repairMissingShipDates(orders, sdMap) {
        var ships = getHistCache();
        var cands = Object.keys(orders).filter(function (no) {
            return !sdMap[no] && !(no in ships);
        }).map(function (no) {
            var w = orders[no] || {};
            return { no: no, orderId: w.id || '', fieldId: w.bsFieldId || '' };
        }).filter(function (c) { return !!c.orderId; });
        if (cands.length === 0) return Promise.resolve();

        showProgress('Repairing ship dates (' + cands.length + ')...');
        var idx = 0;
        function step() {
            if (idx >= cands.length) return Promise.resolve();
            var slice = cands.slice(idx, idx + HIST_PARALLEL);
            idx += HIST_PARALLEL;
            return Promise.all(slice.map(function (c) {
                return fetchShipDateForOrder(c).then(function (res) {
                    var d = res && res.date;
                    if (d && !isNaN(d.getTime())) {
                        var s = getHistCache();
                        s[c.no] = d.toISOString();
                        saveHistCache(s);
                        sdMap[c.no] = d;
                    }
                });
            })).then(step);
        }
        return step();
    }

    // Pulls the "REVISION INFO: ..." line out of a catalog Description. The user
    // marked this column "(fill in later)" — for now it extracts what's there so
    // the column is already populated whenever a description carries the info.
    function parseManualRevInfo(desc) {
        desc = String(desc || '');
        var m = desc.match(/REVISION\s*INFO\s*:\s*(.+)/i);
        if (m && m[1]) return String(m[1]).trim();
        return '';
    }

    // The catalog Description opens with a title line (e.g. "PRESS GAUGE",
    // "HAMILTON-SUNDSTRAND - Component Maintenance Manual"). We skip a leading
    // "Verification Cycle: ..." line and take the first real title line as the
    // fallback "Origin (or description)" value (used when a manual has no
    // linked items / no dominant item-type phrase emerges).
    function parseManualOrigin(desc) {
        desc = String(desc || '');
        var lines = desc.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
        for (var i = 0; i < lines.length; i++) {
            if (/^VERIFICATION\s*CYCLE/i.test(lines[i])) continue;
            return lines[i];
        }
        return '';
    }

    // Item cache: doc GUID -> { descs, ts } so re-runs don't refetch every
    // manual's item list. Persisted in GM storage like the manual cache.
    var ITEMS_CACHE_KEY = SCRIPT_ID + '-items-cache';
    var ITEMS_CACHE_VERSION = 2;
    // Cached REV INFO expires after ~6 months and is then re-read from the
    // manual's Edit page. The item list (Origin) has no expiry.
    var REV_INFO_TTL_MS = 183 * 24 * 60 * 60 * 1000;

    function getItemsCache() {
        try {
            var raw = GM_getValue(ITEMS_CACHE_KEY, null);
            if (!raw) return {};
            var parsed = JSON.parse(raw);
            if (parsed && parsed.v === ITEMS_CACHE_VERSION && parsed.items) return parsed.items;
            if (parsed && typeof parsed === 'object' && !parsed.v) return parsed;   // tolerate bare maps
            return {};
        } catch (e) { return {}; }
    }

    function setItemsCache(items) {
        try { GM_setValue(ITEMS_CACHE_KEY, JSON.stringify({ v: ITEMS_CACHE_VERSION, items: items })); } catch (e) {}
    }

    // ── ONE-FILE BACKUP: download / load every cache + your settings ──
    // Sections: cc (cost centers, warranty, subcontract, users), history (shipped-date
    // history, Manual Used numbers, status field ids), po (PO subcontract flags + order
    // documents), origin (manual item lists + REV INFO with its fetch date; REV INFO
    // older than REV_INFO_TTL_MS is re-read on the next run), settings (Excluded
    // Vendors + PO Removed Rows rules). Loading MERGES into what is already here.
    function auditDownloadJson(obj, filename) {
        var blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function auditCountKeys(o) { return (o && typeof o === 'object') ? Object.keys(o).length : 0; }

    function downloadAllCache() {
        try {
            var users = [];
            try {
                var uraw = GM_getValue(USERS_CACHE_KEY, null);
                users = uraw ? JSON.parse(uraw) : [];
            } catch (e) { users = []; }

            var items = {};
            var srcItems = getItemsCache();
            Object.keys(srcItems).forEach(function (id) {
                var e = srcItems[id];
                if (!e || !Array.isArray(e.descs) || !e.descs.length) return;
                items[id] = { descs: e.descs, ts: e.ts || 0 };
                if (typeof e.revInfo === 'string') { items[id].revInfo = e.revInfo; items[id].revTs = e.revTs || e.ts || 0; }
            });

            var data = {
                type: 'bristow-audit-backup',
                v: 1,
                exportedAt: new Date().toISOString(),
                cc: { costCenters: getCCCache(), warranty: getWarrantyCache(), subcontract: getSubcontractCache(), users: users },
                history: { ships: getHistCache(), manuals: getManualCache(), fields: getFieldCache() },
                po: { poSubcontract: getPOSubcontractCache(), orderDocuments: getOrderDocCache() },
                origin: { items: items },
                settings: { excludedVendors: getExcludedVendors(), poRowExclusions: getPORowExclusions() }
            };
            auditDownloadJson(data, 'bristow-audit-cache-' + new Date().toISOString().slice(0, 10) + '.json');
            showToast('Cache exported: ' + auditCountKeys(data.cc.costCenters) + ' orders, '
                + auditCountKeys(data.history.ships) + ' history, ' + auditCountKeys(items) + ' manuals, '
                + data.settings.excludedVendors.length + ' vendors, ' + data.settings.poRowExclusions.length + ' removal rules', 'success');
        } catch (e) {
            console.error('[AUDIT] cache export failed', e);
            showToast('Cache export failed: ' + e.message, 'warn');
        }
    }

    function mergeCCSection(cc) {
        var n = 0;
        if (cc.costCenters && typeof cc.costCenters === 'object') {
            var m = Object.assign({}, getCCCache(), cc.costCenters);
            setCCCache(m);
            n = auditCountKeys(cc.costCenters);
        }
        if (cc.warranty && typeof cc.warranty === 'object') setWarrantyCache(Object.assign({}, getWarrantyCache(), cc.warranty));
        if (cc.subcontract && typeof cc.subcontract === 'object') setSubcontractCache(Object.assign({}, getSubcontractCache(), cc.subcontract));
        if (Array.isArray(cc.users) && cc.users.length) {
            try {
                GM_setValue(USERS_CACHE_KEY, JSON.stringify(cc.users));
                GM_setValue(USERS_CACHE_AGE_KEY, Date.now());
                USERS = cc.users;
            } catch (e) {}
        }
        return n;
    }

    function mergeHistorySection(h) {
        var n = 0;
        if (h.ships && typeof h.ships === 'object') {
            saveHistCache(Object.assign({}, getHistCache(), h.ships));
            n = auditCountKeys(h.ships);
        }
        if (h.manuals && typeof h.manuals === 'object') {
            var mc = getManualCache();
            Object.keys(h.manuals).forEach(function (k) { mc[k] = h.manuals[k]; });
            setManualCache(mc);
        }
        if (h.fields && typeof h.fields === 'object') {
            try { GM_setValue(FIELD_CACHE_KEY, JSON.stringify(Object.assign({}, getFieldCache(), h.fields))); } catch (e) {}
        }
        return n;
    }

    function mergePOSection(po) {
        if (po.poSubcontract && typeof po.poSubcontract === 'object') {
            setPOSubcontractCache(Object.assign({}, getPOSubcontractCache(), po.poSubcontract));
        }
        if (po.orderDocuments && typeof po.orderDocuments === 'object') {
            setOrderDocCache(Object.assign({}, getOrderDocCache(), po.orderDocuments));
        }
        return auditCountKeys(po.poSubcontract) + auditCountKeys(po.orderDocuments);
    }

    // Item lists and REV INFO merge independently: a newer item list wins, and a
    // newer REV INFO (by revTs) wins, so neither overwrites fresher local data.
    function mergeOriginSection(incoming) {
        var cur = getItemsCache();
        var n = 0;
        Object.keys(incoming || {}).forEach(function (id) {
            var e = incoming[id];
            if (!e || !Array.isArray(e.descs) || !e.descs.length) return;
            var have = cur[id];
            var haveOk = !!(have && Array.isArray(have.descs));
            var inRev = (typeof e.revInfo === 'string') ? { revInfo: e.revInfo, revTs: e.revTs || e.ts || 0 } : null;
            if (!haveOk || (e.ts || 0) > (have.ts || 0)) {
                var next = { descs: e.descs.map(String), ts: e.ts || Date.now() };
                if (inRev) { next.revInfo = inRev.revInfo; next.revTs = inRev.revTs; }
                else if (haveOk && typeof have.revInfo === 'string') { next.revInfo = have.revInfo; next.revTs = have.revTs || have.ts || 0; }
                cur[id] = next;
                n++;
            } else if (inRev && inRev.revTs > (have.revTs || have.ts || 0)) {
                have.revInfo = inRev.revInfo;
                have.revTs = inRev.revTs;
                n++;
            }
        });
        setItemsCache(cur);
        return n;
    }

    // Returns { vendors, rules } = how many were newly added (nothing is deleted).
    function mergeSettingsSection(st) {
        var vend = getExcludedVendors();
        var seenV = {};
        vend.forEach(function (v) { seenV[String(v).trim().toLowerCase()] = true; });
        var addedV = 0;
        (Array.isArray(st.excludedVendors) ? st.excludedVendors : []).forEach(function (v) {
            var t = String(v == null ? '' : v).trim();
            var k = t.toLowerCase();
            if (t && !seenV[k]) { seenV[k] = true; vend.push(t); addedV++; }
        });
        saveExcludedVendors(vend);

        var rules = getPORowExclusions();
        function sig(q) { return q.kind + '|' + poNormText(q.text) + '|' + (q.poId || ''); }
        var seenR = {};
        var seenIds = {};
        rules.forEach(function (q) { seenR[sig(q)] = true; if (q.id) seenIds[q.id] = true; });
        var addedR = 0;
        (Array.isArray(st.poRowExclusions) ? st.poRowExclusions : []).forEach(function (q) {
            if (!q || typeof q !== 'object') return;
            var kind = q.kind;
            if (kind !== 'blank-part' && kind !== 'part-contains' && kind !== 'po') return;
            if (kind === 'part-contains' && !poNormText(q.text)) return;
            if (kind === 'po' && !q.poId) return;
            var clean = { kind: kind, reason: String(q.reason || '').slice(0, 200), addedAt: q.addedAt ? String(q.addedAt) : new Date().toISOString() };
            if (kind === 'part-contains') { clean.text = String(q.text).slice(0, 200); clean.word = !!q.word; }
            if (kind === 'po') { clean.poId = String(q.poId); clean.poNumber = String(q.poNumber || ''); }
            if (seenR[sig(clean)]) return;
            var id = (q.id && !seenIds[q.id]) ? String(q.id) : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            clean.id = id;
            seenIds[id] = true;
            seenR[sig(clean)] = true;
            rules.push(clean);
            addedR++;
        });
        savePORowExclusions(rules);
        return { vendors: addedV, rules: addedR };
    }

    // Loads a backup file made by "Download All Cache". Also understands the older
    // separate files (cache / history / PO / origin / settings) from earlier versions.
    // callback(err, { summary: '...', failed: [names] })
    function loadAllCache(file, callback) {
        var reader = new FileReader();
        reader.onload = function (ev) {
            try {
                var data = JSON.parse(ev.target.result);
                if (!data || typeof data !== 'object') { callback(new Error('Not a cache file')); return; }
                var sec = {};
                if (data.type === 'bristow-audit-backup') {
                    sec = { cc: data.cc, history: data.history, po: data.po, origin: data.origin, settings: data.settings };
                } else {
                    if (data.costCenters !== undefined || data.warranty || data.subcontract) sec.cc = data;
                    if (data.ships || data.manuals) sec.history = { ships: data.ships, manuals: data.manuals };
                    if (data.poSubcontract || data.orderDocuments) sec.po = data;
                    if (data.type === 'bristow-audit-origin-cache') sec.origin = { items: data.items };
                    if (data.type === 'bristow-audit-settings') sec.settings = data;
                }
                if (!Object.keys(sec).some(function (k) { return sec[k] && typeof sec[k] === 'object'; })) {
                    callback(new Error('Unrecognized cache file'));
                    return;
                }
                var parts = [];
                var failed = [];
                function run(name, fn) {
                    try { fn(); } catch (e) { console.error('[AUDIT] cache load: ' + name + ' failed', e); failed.push(name); }
                }
                if (sec.cc && typeof sec.cc === 'object') run('cost centers', function () { parts.push(mergeCCSection(sec.cc) + ' orders'); });
                if (sec.history && typeof sec.history === 'object') run('history', function () { parts.push(mergeHistorySection(sec.history) + ' history'); });
                if (sec.po && typeof sec.po === 'object') run('PO cache', function () { parts.push(mergePOSection(sec.po) + ' PO entries'); });
                if (sec.origin && sec.origin.items && typeof sec.origin.items === 'object') run('origin', function () { parts.push(mergeOriginSection(sec.origin.items) + ' manuals'); });
                if (sec.settings && typeof sec.settings === 'object') run('settings', function () {
                    var r = mergeSettingsSection(sec.settings);
                    parts.push(r.vendors + ' vendors, ' + r.rules + ' removal rules added');
                });
                callback(null, { summary: parts.join(', '), failed: failed });
            } catch (err) { callback(err); }
        };
        reader.readAsText(file);
    }

    function xhrGetText(url) {
        return new Promise(function (resolve) {
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.timeout = 8000;
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4) return;
                    resolve(xhr.status === 200 ? xhr.responseText : null);
                };
                xhr.onerror = function () { resolve(null); };
                xhr.ontimeout = function () { resolve(null); };
                xhr.send();
            } catch (e) { resolve(null); }
        });
    }

    // Extracts the authoritative Revision Info from an EditDocumentation page.
    function parseEditPageRevInfo(html) {
        html = String(html || '');
        var m = html.match(/id="Documentation_RevisionInfo"[^>]*?\svalue="([^"]*)"/i)
            || html.match(/name="Documentation\.RevisionInfo"[^>]*?\svalue="([^"]*)"/i);
        if (m && m[1]) {
            return String(m[1])
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&nbsp;/g, ' ')
                .trim();
        }
        return '';
    }

    // Fetches a documentation's linked items (via the same handler the Edit
    // page's itemGrid uses) AND the authoritative Revision Info from the Edit
    // page itself. Resolves { descs: [...], revInfo: '...' }, or
    // { descs: [], revInfo: '' } on any hard failure.
    function fetchManualMeta(docId) {
        var out = { descs: [], revInfo: '', revOk: false };
        if (!docId) return Promise.resolve(out);
        var itemsUrl = '/Catalog/Documentations/EditDocumentation?documentationId=' + encodeURIComponent(docId) + '&handler=Items';
        var pageUrl = '/Catalog/Documentations/EditDocumentation?id=' + encodeURIComponent(docId);
        return Promise.all([xhrGetText(itemsUrl), xhrGetText(pageUrl)]).then(function (res) {
            var body = res[0];
            try {
                if (typeof body === 'string') {
                    var parsed = JSON.parse(body);
                    var items = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.Data) ? parsed.Data : []);
                    for (var i = 0; i < items.length; i++) {
                        var d = String(items[i] && items[i].Description || '').trim();
                        if (d) out.descs.push(d);
                    }
                }
            } catch (e) {
                console.warn('[AUDIT] manual items response unparseable', docId, e);
            }
            out.revOk = (typeof res[1] === 'string');
            out.revInfo = parseEditPageRevInfo(res[1]);
            return out;
        });
    }

    // REV INFO only (fresh read of the Edit page). Used when the item list came
    // from the cache but its cached REV INFO is missing or older than the TTL.
    // Resolves null when the page could not be read, so a failed read is never cached.
    function fetchManualRevInfo(docId) {
        if (!docId) return Promise.resolve(null);
        return xhrGetText('/Catalog/Documentations/EditDocumentation?id=' + encodeURIComponent(docId)).then(function (html) {
            return typeof html === 'string' ? parseEditPageRevInfo(html) : null;
        });
    }

    // Picks the most common repeating item-type phrase across a manual's linked
    // items (e.g. "PRESS GAUGE" for 4086). Normalizes descriptions, tokenizes,
    // counts word 1-3 grams, and returns the highest-frequency phrase. Falls
    // back to '' when nothing repeats.
    function dominantItemTypePhrase(descs) {
        descs = (descs || []).filter(function (d) { return String(d || '').trim(); });
        if (!descs.length) return '';

        function norm(s) {
            return String(s || '')
                .toUpperCase()
                .replace(/\s+/g, ' ')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/[^A-Z0-9 ]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        var counts = {};
        function bump(phrase) {
            if (!phrase) return;
            var key = phrase.toUpperCase();
            counts[key] = (counts[key] || 0) + 1;
        }

        var stopWords = {
            WITH:1, AND:1, THE:1, FOR:1, KIT:1, ASSY:1, SERIES:1, ONLY:1, TYPE:1,
            PART:1, NO:1, PN:1, TOOL:1, TEST:1, SET:1, GAUGES:1, NOT:1, OR:1
        };

        descs.forEach(function (d) {
            var toks = norm(d).split(' ').filter(function (t) {
                if (!t || t.length <= 1) return false;
                if (/^[\d.\-,/:]+$/.test(t)) return false;              // pure numbers / PNs
                if (/^P-\d+$/i.test(t)) return false;                    // part numbers
                return !stopWords[t];
            });
            for (var i = 0; i < toks.length; i++) {
                bump(toks[i]);
                if (i + 1 < toks.length) bump(toks[i] + ' ' + toks[i + 1]);
                if (i + 2 < toks.length) bump(toks[i] + ' ' + toks[i + 1] + ' ' + toks[i + 2]);
            }
        });

        // Pick the most frequent multi-word phrase first (>=2 words, occurring
        // in more than one item). Only if nothing repeats do we fall back to a
        // dominant single token. Ties prefer the longer phrase.
        var best = '';
        var bestCount = 0;
        var bestLen = 0;

        function consider(phrase) {
            var c = counts[phrase];
            if (!c) return;
            var len = phrase.split(' ').length;
            if (c > bestCount || (c === bestCount && len > bestLen)) {
                best = phrase;
                bestCount = c;
                bestLen = len;
            }
        }

        Object.keys(counts).forEach(function (phrase) {
            if (counts[phrase] >= 2 && phrase.indexOf(' ') !== -1) consider(phrase);
        });
        if (!best) {
            Object.keys(counts).forEach(function (phrase) {
                if (phrase.indexOf(' ') === -1) consider(phrase);
            });
        }

        // Title-case the result so it reads nicer than ALL CAPS.
        function titleCase(s) {
            return String(s).toLowerCase().split(/ +/).map(function (w) {
                return w.charAt(0).toUpperCase() + w.slice(1);
            }).join(' ');
        }

        return best ? titleCase(best) : '';
    }

    // Resolves the Origin AND authoritative Revision Info for a set of manuals:
    // given a map of manual number -> { id (doc GUID) }, fetch each manual's
    // item descriptions + Edit page (cached in GM), derive the dominant
    // item-type phrase, and return { originMap, revMap } keyed by manual number.
    // Manuals without a doc id or without items keep their description-based
    // Origin / REV INFO (caller's responsibility).
    function resolveManualOrigins(manualToDoc, onProgress) {
        var cache = getItemsCache();
        var dbCache = {};
        var revCache = {};
        var entries = Object.keys(manualToDoc)
            .filter(function (mn) { return !!manualToDoc[mn]; })
            .map(function (mn) { return { mn: mn, id: manualToDoc[mn] }; });
        if (!entries.length) return Promise.resolve({ originMap: {}, revMap: {} });

        var idx = 0;
        var total = entries.length;
        var lastProgressTs = Date.now();

        function step() {
            if (idx >= total) { setItemsCache(cache); return Promise.resolve({ originMap: dbCache, revMap: revCache }); }
            var batch = entries.slice(idx, idx + CC_PARALLEL);
            idx += CC_PARALLEL;
            return Promise.all(batch.map(function (e) {
                var cached = cache[e.id];
                if (cached && Array.isArray(cached.descs) && cached.descs.length) {
                    var phr = dominantItemTypePhrase(cached.descs);
                    if (phr) dbCache[e.mn] = phr;
                    // Origin comes from the cache. REV INFO is reused while it is younger than
                    // REV_INFO_TTL_MS (~6 months), otherwise re-read from the Edit page.
                    var revAge = Date.now() - (cached.revTs || cached.ts || 0);
                    if (typeof cached.revInfo === 'string' && revAge >= 0 && revAge < REV_INFO_TTL_MS) {
                        if (cached.revInfo) revCache[e.mn] = cached.revInfo;
                        return Promise.resolve();
                    }
                    return fetchManualRevInfo(e.id).then(function (ri) {
                        if (ri === null) {
                            // Could not read the page: use the stale value if there is one, and retry next run.
                            if (cached.revInfo) revCache[e.mn] = cached.revInfo;
                            return;
                        }
                        cached.revInfo = ri;
                        cached.revTs = Date.now();
                        if (ri) revCache[e.mn] = ri;
                    });
                }
                return fetchManualMeta(e.id).then(function (meta) {
                    // Only cache a real item list (an empty one is retried next run). REV INFO is
                    // cached with its own timestamp, and only when the Edit page was actually read.
                    if (meta.descs.length) {
                        var entry = { descs: meta.descs, ts: Date.now() };
                        if (meta.revOk) { entry.revInfo = meta.revInfo; entry.revTs = entry.ts; }
                        cache[e.id] = entry;
                    }
                    if (meta.descs.length) dbCache[e.mn] = dominantItemTypePhrase(meta.descs);
                    if (meta.revInfo) revCache[e.mn] = meta.revInfo;
                });
            })).then(function () {
                if (onProgress && Date.now() - lastProgressTs > 1500) {
                    lastProgressTs = Date.now();
                    onProgress(Math.min(idx, total), total);
                }
                return step();
            });
        }
        return step();
    }

    // Manual Inhouse = every YEG/BRI work order (ALL statuses — not just
    // completed/shipped) tallied by which manual its Selected aero-document
    // uses. Manual LOC / REV INFO / Origin are joined from the Documentations
    // catalog (Name = manual number, Location = dock/rack LOC). Sorted by Total
    // highest first. The "Use date range" checkbox gates the scan by the order's
    // Created date. GIDEP (runManualInhouse('BL', 'gidep')) is the same report
    // restricted to manuals whose catalog Location starts with 'BL'.
    function runManualInhouse(locPrefix, reportKey) {
        reportKey = reportKey || 'manualInhouse';
        if (locPrefix) locPrefix = String(locPrefix).toUpperCase();
        var reportCfg = REPORTS[reportKey] || REPORTS.manualInhouse;
        var reportLabel = (reportCfg && reportCfg.label) || 'Manual Inhouse';
        var applyRange = !!(pendingFilters && pendingFilters[reportKey + 'ApplyRange']);

        var g = getKendoGrid('grid');
        if (!g || !g.dataSource) {
            showToast('Documentations grid not found', 'warn');
            return;
        }

        showProgress('Loading Documentation catalog...');

        var origPageSize = g.dataSource.pageSize();
        g.dataSource.pageSize(99999);

        // Same read-all trick as runTimeSensitiveLib: the server handler only
        // honors its own wRelated/anti-forgery payload, so clear Kendo filters.
        g.dataSource.filter([]);

        var done = false;
        var cleanup = null;

        var onLoaded = function () {
            try { g.dataSource.pageSize(origPageSize); } catch (e) {}

            var all = g.dataSource.data();
            var catMap = {};
            for (var i = 0; i < all.length; i++) {
                var r = all[i].toJSON ? all[i].toJSON() : all[i];
                var nm = String(r.Name || '').trim();
                var mn = extractManualNumber(nm);
                if (!mn || (mn in catMap)) continue;
                var desc = String(r.Description || '').trim();
                catMap[mn] = {
                    name: nm,
                    id: String(r.Id || '').trim(),
                    loc: String(r.Location || '').trim(),
                    origin: parseManualOrigin(desc),
                    revInfo: parseManualRevInfo(desc)
                };
            }

            showProgress('Loading ALL work orders from Work Orders grid...');

            bulkFetchOrderRepMap()
                .then(function (woMap) {
                    var sRangeStart = null, sRangeEnd = null;
                    if (applyRange) {
                        var rangeDates = getDateRange();
                        if (rangeDates.start) { sRangeStart = new Date(rangeDates.start); sRangeStart.setHours(0, 0, 0, 0); }
                        if (rangeDates.end) { sRangeEnd = new Date(rangeDates.end); sRangeEnd.setHours(23, 59, 59, 999); }
                    }

                    var pairs = [];
                    var cancelledCount = 0;
                    Object.keys(woMap).forEach(function (no) {
                        var w = woMap[no];
                        var seg = officeCodeFromOrder(no);
                        if (seg !== 'YEG' && seg !== 'BRI') return;
                        if (w.orderStatus === 3) { cancelledCount++; return; }   // OrderStatus 3 = Cancelled
                        if (applyRange) {
                            var c = w.createdAt && w.createdAt.getTime ? w.createdAt.getTime() : null;
                            if (!c) return;
                            if (sRangeStart && c < sRangeStart.getTime()) return;
                            if (sRangeEnd && c > sRangeEnd.getTime()) return;
                        }
                        pairs.push({ no: no, id: w.id || '' });
                    });

                    if (pairs.length === 0) {
                        hideProgress();
                        showToast(applyRange
                            ? 'No YEG/BRI work orders in the selected date range'
                            : 'No YEG/BRI work orders found in the grid', 'info');
                        return;
                    }

                    var manualIds = pairs.map(function (p) { return p.id; }).filter(Boolean);
                    showProgress('Fetching manuals (' + manualIds.length + ')...');

                    resolveManualsByIds(manualIds, function (d, t) {
                        showProgress('Fetching manuals (' + d + '/' + t + ')...');
                    }).then(function (manualCacheById) {
                        hideProgress();

                        var tally = {};
                        pairs.forEach(function (p) {
                            var mu = (p.id && manualCacheById[p.id]) || '';
                            if (!mu) return;
                            tally[mu] = (tally[mu] || 0) + 1;
                        });

                        // GIDEP mode restricts the tally to manuals whose catalog Location
                        // starts with the prefix (e.g. 'BL'); blank prefix = all.
                        var tallyKeys = Object.keys(tally).filter(function (mn) {
                            if (!locPrefix) return true;
                            var m = catMap[mn] || {};
                            return String(m.loc || '').trim().toUpperCase().indexOf(locPrefix) === 0;
                        });

                        // Map each manual number to its catalog doc GUID so we
                        // can fetch the manual's linked items for the Origin col.
                        var manualToDoc = {};
                        tallyKeys.forEach(function (mn) {
                            var m = catMap[mn];
                            if (m && m.id) manualToDoc[mn] = m.id;
                        });

                        var renderRows = function (originMap, revMap) {
                            var rows = tallyKeys.map(function (mn) {
                                var m = catMap[mn] || {};
                                return {
                                    manual: mn,
                                    loc: m.loc || '',
                                    revInfo: (revMap && revMap[mn]) || m.revInfo || '',
                                    origin: (originMap && originMap[mn]) || m.origin || '',
                                    total: tally[mn]
                                };
                            });

                            rows.sort(function (a, b) {
                                if (b.total !== a.total) return b.total - a.total;
                                return String(a.manual).localeCompare(String(b.manual));
                            });

                            if (rows.length === 0) {
                                showToast('No work orders have a selected manual yet', 'info');
                                return;
                            }

                            var unknown = 0;
                            var manualTotal = 0;
                            rows.forEach(function (r) {
                                if (!r.loc && !r.origin && !r.revInfo) unknown++;
                                manualTotal += r.total;
                            });
                            var allManualTotal = 0;
                            Object.keys(tally).forEach(function (mn) { allManualTotal += tally[mn]; });
                            var noManual = pairs.length - allManualTotal;
                            var otherManual = allManualTotal - manualTotal;
                            var grandTotal = pairs.length;
                            var manualLabel = locPrefix
                                ? ('Orders with a ' + locPrefix + ' manual')
                                : 'Orders with a manual';

                            var dateLabel = '';
                            if (applyRange) {
                                var dates = getDateRange();
                                if (dates.start && dates.end) dateLabel = toDisplayDate(dates.start) + ' to ' + toDisplayDate(dates.end);
                                else if (dates.start) dateLabel = 'From ' + toDisplayDate(dates.start);
                                else if (dates.end) dateLabel = 'Up to ' + toDisplayDate(dates.end);
                                else dateLabel = 'All dates';
                            }

                            embedReportPanel({
                                rows: rows,
                                title: reportLabel,
                                subtitle: 'Generated: ' + new Date().toLocaleDateString()
                                    + (applyRange
                                        ? (' — Created ' + dateLabel)
                                        : ' — All time (no date filter)')
                                    + (locPrefix ? ' — ' + locPrefix + '-location manuals only' : '')
                                    + (unknown ? ' — ' + unknown + ' manual(s) with no catalog match' : '')
                                    + (!rows.length
                                        ? ''
                                        : (locPrefix
                                            ? (' — ' + manualTotal + ' order(s) with a ' + locPrefix + ' manual, ' + noManual + ' without, ' + otherManual + ' with another manual (of ' + grandTotal + ')')
                                            : (' — ' + manualTotal + ' order(s) with a manual, ' + noManual + ' without (of ' + grandTotal + ')')))
                                    + (cancelledCount ? ' — excludes ' + cancelledCount + ' cancelled' : ''),
                                columns: ['#', 'Manual', 'Manual LOC', 'Man. REV. INFO', 'Origin', 'Total'],
                                sampleColumns: [
                                    { title: 'Manual', get: function (r) { return r.manual || ''; } },
                                    { title: 'Manual LOC', get: function (r) { return r.loc || ''; } },
                                    { title: 'Man. REV. INFO', get: function (r) { return r.revInfo || ''; } },
                                    { title: 'Origin', get: function (r) { return r.origin || ''; } },
                                    { title: 'Total', get: function (r) { return r.total == null ? '' : r.total; } }
                                ],
                                rowsHtml: function (rs) {
                                    var out = '';
                                    rs.forEach(function (r, i) {
                                        out += '<tr>'
                                            + '<td>' + (i + 1) + '</td>'
                                            + '<td class="aoc-mono">' + (r.manual || '') + '</td>'
                                            + '<td>' + (r.loc || '') + '</td>'
                                            + '<td>' + (r.revInfo || '') + '</td>'
                                            + '<td>' + (r.origin || '') + '</td>'
                                            + '<td class="aoc-mono">' + r.total + '</td>'
                                            + '</tr>';
                                    });
                                    if (rs.length) {
                                        var foot = function (label, n, last) {
                                            return '<tr style="border-top:1px solid #999' + (last ? ';font-weight:bold' : '') + '">'
                                                + '<td></td><td>' + label + '</td><td></td><td></td><td></td>'
                                                + '<td class="aoc-mono">' + n + '</td></tr>';
                                        };
                                        out += foot(manualLabel, manualTotal, false);
                                        out += foot('Orders with no manual', noManual, false);
                                        if (otherManual) out += foot('Orders with another manual', otherManual, false);
                                        out += foot('Grand total', grandTotal, true);
                                    }
                                    return out;
                                },
                                onExport: function () {
                                    exportManualInhouseExcel(rows, {
                                        manualTotal: manualTotal,
                                        noManual: noManual,
                                        otherManual: otherManual,
                                        grandTotal: grandTotal,
                                        manualLabel: manualLabel,
                                        fileBase: (reportKey === 'gidep') ? 'GIDEP' : 'Manual-Inhouse'
                                    });
                                },
                                onPrint: function () {
                                    generateManualInhousePrintout(rows, {
                                        applyRange: applyRange,
                                        manualTotal: manualTotal,
                                        noManual: noManual,
                                        otherManual: otherManual,
                                        grandTotal: grandTotal,
                                        manualLabel: manualLabel,
                                        title: reportLabel
                                    });
                                }
                            });
                        };

                        if (Object.keys(manualToDoc).length === 0) { renderRows({}, {}); return; }

                        showProgress('Fetching linked items + revision info...');
                        resolveManualOrigins(manualToDoc, function (d, t) {
                            showProgress('Fetching linked items + revision info (' + d + '/' + t + ')...');
                        }).then(function (res) {
                            hideProgress();
                            res = res || {};
                            renderRows(res.originMap || {}, res.revMap || {});
                        }).catch(function () {
                            hideProgress();
                            renderRows({}, {});
                        });
                    });
                })
                .catch(function (err) {
                    hideProgress();
                    console.error('[AUDIT] Manual Inhouse failed', err);
                    showToast('Manual Inhouse failed: ' + (err && err.message ? err.message : err), 'warn');
                });
        };

        var handler = function () {
            if (done) return;
            done = true;
            try { g.dataSource.unbind('requestEnd', handler); } catch (e) {}
            if (cleanup) { clearTimeout(cleanup); cleanup = null; }
            setTimeout(onLoaded, 300);
        };
        g.dataSource.bind('requestEnd', handler);

        if (typeof searchGrid === 'function') {
            searchGrid();
        } else {
            g.dataSource.read();
        }

        cleanup = setTimeout(function () {
            if (done) return;
            done = true;
            try { g.dataSource.unbind('requestEnd', handler); } catch (e) {}
            onLoaded();
        }, 15000);
    }

    function runManualUsage() {
        // Read the manual-number search box + its "use date range" checkbox.
        var manualNo = pendingFilters && pendingFilters.manualNumber
            ? String(pendingFilters.manualNumber).trim() : '';
        var applyManualRange = !!(pendingFilters && pendingFilters.manualApplyRange);

        // The date range is applied ONLY when the "Use date range" checkbox is
        // checked — otherwise list ALL shipped units (last one filtered by the
        // manual number if one was entered). This holds for both a blank and a
        // filled search box.
        var ignoreRange = !applyManualRange;
        var dates = getDateRange();
        var scanDates = ignoreRange ? { start: null, end: null } : dates;

        showProgress('Loading completed/shipped orders from Work Orders grid...');

        bulkFetchOrderRepMap()
            .then(function (woMap) {
            var filtered = {};
            Object.keys(woMap).forEach(function (no) {
                var w = woMap[no];
                var seg = officeCodeFromOrder(no);
                if (seg !== 'YEG' && seg !== 'BRI') return;
                // EVERY non-cancelled order (shipped or not): the report keeps
                // the Shipped Date column blank for orders that haven't shipped.
                if (w.orderStatus === 3) return;
                filtered[no] = w;
            });

            var filteredCount = Object.keys(filtered).length;
            if (filteredCount === 0) {
                hideProgress();
                showToast('No non-cancelled YEG/BRI orders found in the grid', 'info');
                return;
            }

            showProgress('Checking Bristow Status history for ' + filteredCount + ' orders...');
            expandShipDatesFromHistory(filtered, scanDates, null, false)
                .catch(function () { return {}; })
                .then(function (sdMap) {
                    return repairMissingShipDates(filtered, sdMap).then(function () { return sdMap; });
                })
                .then(function (sdMap) {
                    // Shipped date is the recovered StatusHistory transition only;
                    // orders that never shipped stay blank (no CreatedAt stand-in).
                    var shipMap = sdMap || {};

                    // Apply the date-range filter only when we're not in
                    // "manual-number — all history" mode. Ranged runs keep only
                    // orders with a recovered shipped date inside the range.
                    var list = Object.keys(filtered);
                    if (!ignoreRange) {
                        var sRangeStart = null, sRangeEnd = null;
                        if (dates.start) { sRangeStart = new Date(dates.start); sRangeStart.setHours(0, 0, 0, 0); }
                        if (dates.end) { sRangeEnd = new Date(dates.end); sRangeEnd.setHours(23, 59, 59, 999); }
                        list = list.filter(function (no) {
                            var d = shipMap[no];
                            if (!d || !d.getTime) return false;
                            var t = d.getTime();
                            if (sRangeStart && t < sRangeStart.getTime()) return false;
                            if (sRangeEnd && t > sRangeEnd.getTime()) return false;
                            return true;
                        });
                    }
                    if (list.length === 0) {
                        hideProgress();
                        var msg = manualNo
                            ? 'No orders matched manual ' + manualNo
                            : (ignoreRange ? 'No orders found' : 'No orders found for the selected range');
                        showToast(msg, 'info');
                        return;
                    }

                    // Fetch the "Manual Used" numbers for these orders. Cached
                    // end-to-end (per order Id), so repeat runs only refetch
                    // orders whose manual isn't known yet.
                    var manualIds = list.map(function (no) {
                        return (woMap[no] && woMap[no].id) || '';
                    }).filter(Boolean);

                    showProgress('Fetching manuals (' + manualIds.length + ')...');

                    resolveManualsByIds(manualIds, function (d, t) {
                        showProgress('Fetching manuals (' + d + '/' + t + ')...');
                    }).then(function (manualCacheById) {
                        hideProgress();
                        var rows = [];
                        list.forEach(function (orderNo) {
                            var w = woMap[orderNo] || {};
                            var mu = (w.id && manualCacheById[w.id]) || '';
                            if (manualNo && mu !== manualNo) return;
                            rows.push({
                                order: orderNo,
                                orderId: w.id || '',
                                component: w.component || '',
                                shippedDate: shipMap[orderNo] || null,
                                manualUsed: mu,
                                fallback: false
                            });
                        });

                        rows.sort(function (a, b) {
                            var na = parseInt(String(a.manualUsed).trim(), 10);
                            var nb = parseInt(String(b.manualUsed).trim(), 10);
                            if (isNaN(na)) na = Infinity;
                            if (isNaN(nb)) nb = Infinity;
                            if (na !== nb) return na - nb;
                            var ta = a.shippedDate && a.shippedDate.getTime ? a.shippedDate.getTime() : Math.pow(2, 53);
                            var tb = b.shippedDate && b.shippedDate.getTime ? b.shippedDate.getTime() : Math.pow(2, 53);
                            if (ta !== tb) return ta - tb;
                            return String(a.order).localeCompare(String(b.order));
                        });

                        if (rows.length === 0) {
                            var noMsg = manualNo
                                ? 'No shipped orders matched manual ' + manualNo
                                : (ignoreRange ? 'No shipped orders found' : 'No shipped orders found for the selected range');
                            showToast(noMsg, 'info');
                            return;
                        }

                        var dateLabel = '';
                        if (!ignoreRange) {
                            if (dates.start && dates.end) {
                                dateLabel = toDisplayDate(dates.start) + ' to ' + toDisplayDate(dates.end);
                            } else if (dates.start) {
                                dateLabel = 'From ' + toDisplayDate(dates.start);
                            } else if (dates.end) {
                                dateLabel = 'Up to ' + toDisplayDate(dates.end);
                            } else {
                                dateLabel = 'All dates';
                            }
                        }

                        embedReportPanel({
                            rows: rows,
                            title: manualNo ? 'Manual Usage — ' + manualNo : 'Manual Usage',
                            subtitle: 'Generated: ' + new Date().toLocaleDateString()
                                + (dateLabel ? ' — Date range: ' + dateLabel : '')
                                + (ignoreRange ? ' — Ignoring date range' : '')
                                + (manualNo ? ' — Filtered by Manual ' + manualNo : ''),
                            columns: ['#', 'Order', 'Component', 'Shipped Date', 'Manual Used'],
                            sampleColumns: [
                                { title: 'Order', get: function (r) { return r.order || ''; } },
                                { title: 'Component', get: function (r) { return r.component || ''; } },
                                { title: 'Shipped Date', get: function (r) { return r.shippedDate; } }
                            ],
                            sampleLink: function (r) { return r.orderId ? '/Orders/Orders/Edit?id=' + encodeURIComponent(r.orderId) : ''; },
                            rowsHtml: function (rs) {
                                var out = '';
                                rs.forEach(function (r, i) {
                                    out += '<tr>'
                                        + '<td>' + (i + 1) + '</td>'
                                        + '<td>' + orderLinkHtml(r.order, r.orderId) + '</td>'
                                        + '<td>' + (r.component || '') + '</td>'
                                        + '<td>' + toDisplayDate(r.shippedDate)
                                        + (r.fallback ? ' <span style="color:#b8860b;" title="Shipped date not recovered - showing Created date">*</span>' : '')
                                        + '</td>'
                                        + '<td class="aoc-mono">' + (r.manualUsed || '') + '</td>'
                                        + '</tr>';
                                });
                                return out;
                            },
                            onExport: function () { exportManualUsageExcel(rows); },
                            onPrint: function () { generateManualUsagePrintout(rows, { manualNo: manualNo, ignoreRange: ignoreRange }); }
                        });
                    });
                });
        });
    }

    // Try to open the report in a popup; if the popup blocker returns null,
    // render the same HTML in a centered on-page panel styled like the popup
    // (Print via a hidden iframe, Export and Close bound to the panel directly).
    function showPrintout(html, onExport) {
        if (typeof onExport === 'function') {
            try { window.__auditExport = onExport; } catch (e) {}
            try { if (window.unsafeWindow) window.unsafeWindow.__auditExport = onExport; } catch (e) {}
        }
        var w = null;
        try { w = window.open('', '_blank', 'width=1000,height=700'); } catch (e) { w = null; }
        if (w) {
            try { w.document.write(html); w.document.close(); } catch (e) {
                try { w.close(); } catch (e2) {}
                w = null;
            }
        }
        if (w) return;

        var overlay = document.createElement('div');
        overlay.id = SCRIPT_ID + '-printout-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:24px;';
        document.body.appendChild(overlay);
        var panel = document.createElement('div');
        panel.style.cssText = 'position:relative;width:1000px;max-width:100%;height:700px;max-height:100%;background:#fff;box-shadow:0 4px 28px rgba(0,0,0,.45);overflow:auto;';
        panel.innerHTML = html;
        overlay.appendChild(panel);
        var btns = panel.querySelectorAll('button');
        Array.prototype.forEach.call(btns, function (btn) {
            var oc = btn.getAttribute('onclick') || '';
            btn.removeAttribute('onclick');
            if (/window\.print/.test(oc)) {
                btn.onclick = function () { printHtmlViaFrame(html); };
            } else if (/__auditExport/.test(oc)) {
                btn.onclick = function () { if (typeof onExport === 'function') onExport(); else showToast('Export not available', 'warn'); };
            } else if (/window\.close/.test(oc)) {
                btn.onclick = function () { document.body.style.overflow = ''; overlay.remove(); };
            }
        });
        document.body.style.overflow = 'hidden';
    }

    function printHtmlViaFrame(html) {
        var fr = document.createElement('iframe');
        fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
        document.body.appendChild(fr);
        var d = null;
        try { d = fr.contentDocument || (fr.contentWindow && fr.contentWindow.document); } catch (e) {}
        if (!d) { try { fr.remove(); } catch (e) {} return; }
        try { d.open(); d.write(html); d.close(); } catch (e) {
            try { fr.remove(); } catch (e2) {}
            return;
        }
        setTimeout(function () {
            try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) {}
            setTimeout(function () { try { fr.remove(); } catch (e2) {} }, 2000);
        }, 300);
    }

    function generateInventoryPrintout(rows, title, onExport) {
        var now = new Date();
        var dateLabel = String(now.getDate()).padStart(2, '0') + '-' + MONTHS[now.getMonth()] + '-' + now.getFullYear();

        var h = '<html><head><title>' + title + '</title><style>';
        h += 'body{font-family:Arial,sans-serif;font-size:8px;margin:20px}';
        h += 'table{border-collapse:collapse;width:100%;font-size:8px}';
        h += 'th{background:#fff;color:#000;padding:5px 8px;text-align:left;font-size:12px;border-bottom:1px solid #999;font-weight:bold}';
        h += 'td{padding:4px 8px;border-bottom:1px solid #999;vertical-align:top;font-size:8px}';
        h += 'tr:nth-child(even) td{background:#f5f5f5}';
        h += '.mono{font-family:monospace}';
        h += '@media print{button{display:none}}';
        h += '</style></head><body>';
        h += '<h2>' + title + ' &mdash; ' + rows.length + '</h2>';
        h += '<p style="font-size:10px;color:#666;">Generated: ' + dateLabel + '</p>';
        h += '<div style="margin-top:8px;margin-bottom:12px;display:flex;gap:8px;">';
        h += '<button onclick="window.print()" style="background:#378ADD;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Print</button>';
        if (onExport) {
            h += '<button onclick="opener.__auditExport()" style="background:#27ae60;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Export to Excel</button>';
        }
        h += '<button onclick="window.close()" style="background:#666;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Close</button>';
        h += '</div>';
        h += '<table><thead><tr>';
        h += '<th>#</th><th>Part Number</th><th>Description</th><th>Location</th><th>PO</th><th>EXP</th><th>Quantity</th>';
        h += '</tr></thead><tbody>';
        rows.forEach(function (r, i) {
            h += '<tr>';
            h += '<td>' + (i + 1) + '</td>';
            h += '<td class="mono">' + (r.partNumber || '') + '</td>';
            h += '<td>' + (r.description || '') + '</td>';
            h += '<td class="mono">' + (r.location || '') + '</td>';
            h += '<td class="mono">' + (r.po || '') + '</td>';
            h += '<td class="mono">' + (r.exp || '') + '</td>';
            h += '<td>' + (r.stocked || '') + '</td>';
            h += '</tr>';
        });
        h += '</tbody></table>';
        h += '<p style="font-size:9px;color:#999;margin-top:12px;">Generated by AUDIT - Compliance Report Generator | Bristow Scripts</p>';
        h += '</body></html>';

        showPrintout(h, onExport);
    }

    function exportInventoryExcel(rows, title) {
        try {
            if (typeof XLSX === 'undefined') {
                showToast('Excel library (SheetJS) not loaded', 'warn');
                return;
            }
            var aoa = [['#', 'Part Number', 'Category', 'Description', 'Location', 'PO', 'EXP', 'Quantity', 'Condition', 'Market Value', 'Incoming', 'Claimed', 'Reserved', 'Picked', 'Note']];
            rows.forEach(function (r, i) {
                aoa.push([
                    i + 1,
                    r.partNumber,
                    r.category,
                    r.description,
                    r.location,
                    r.po || '',
                    r.exp || '',
                    r.stocked,
                    r.condition,
                    r.marketValue == null ? '' : r.marketValue,
                    r.incoming,
                    r.claimed,
                    r.reserved,
                    r.picked,
                    r.note
                ]);
            });
            var ws = XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = [
                { wch: 6 }, { wch: 18 }, { wch: 14 }, { wch: 50 }, { wch: 12 }, { wch: 16 }, { wch: 16 },
                { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 30 }
            ];
            ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } }) };
            var wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
            var fname = 'AUDIT-' + title.replace(/[^\w]+/g, '-') + '-' + new Date().toISOString().slice(0, 10) + '.xlsx';
            XLSX.writeFile(wb, fname);
            showToast('Exported ' + rows.length + ' items to ' + fname, 'success');
        } catch (e) {
            console.error('[AUDIT] Inventory export failed', e);
            showToast('Inventory export failed: ' + e.message, 'warn');
        }
    }

    function exportManualUsageExcel(rows) {
        try {
            if (typeof XLSX === 'undefined') {
                showToast('Excel library (SheetJS) not loaded — check the userscript @require', 'warn');
                return;
            }
            var base = location.origin;
            var aoa = [['#', 'Order', 'Component', 'Shipped Date', 'Manual Used']];
            rows.forEach(function (r, i) {
                aoa.push([
                    i + 1,
                    r.order,
                    r.component || '',
                    r.shippedDate ? toDisplayDate(r.shippedDate) + (r.fallback ? ' *' : '') : '',
                    r.manualUsed || ''
                ]);
            });
            var ws = XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = [
                { wch: 6 }, { wch: 20 }, { wch: 30 }, { wch: 16 }, { wch: 14 }
            ];
            ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } }) };
            for (var i = 0; i < rows.length; i++) {
                var rid = rows[i].orderId;
                if (!rid) continue;
                var cell = XLSX.utils.encode_cell({ r: i + 1, c: 1 });
                ws[cell] = { t: 's', v: rows[i].order, l: { Target: base + '/Orders/Orders/Edit?id=' + encodeURIComponent(rid) } };
            }
            var wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Manual Usage');
            var fname = 'AUDIT-Manual-Usage-' + new Date().toISOString().slice(0, 10) + '.xlsx';
            XLSX.writeFile(wb, fname);
            showToast('Exported ' + rows.length + ' rows to ' + fname, 'success');
        } catch (e) {
            console.error('[AUDIT] Manual Usage export failed', e);
            showToast('Manual Usage export failed: ' + e.message, 'warn');
        }
    }

    function generateManualUsagePrintout(rows, opts) {
        opts = opts || {};
        var manualNo = opts.manualNo || '';
        var ignoreRange = !!opts.ignoreRange;
        var dates = getDateRange();
        var dateLabel = '';
        if (dates.start && dates.end) {
            dateLabel = toDisplayDate(dates.start) + ' to ' + toDisplayDate(dates.end);
        } else if (dates.start) {
            dateLabel = 'From ' + toDisplayDate(dates.start);
        } else if (dates.end) {
            dateLabel = 'Up to ' + toDisplayDate(dates.end);
        } else {
            dateLabel = 'All dates';
        }
        var hasFallback = rows.some(function (r) { return !!r.fallback; });

        var h = '<html><head><title>Manual Usage</title><style>';
        h += 'body{font-family:Arial,sans-serif;font-size:8px;margin:20px}';
        h += 'table{border-collapse:collapse;width:100%;font-size:8px}';
        h += 'th{background:#fff;color:#000;padding:5px 8px;text-align:left;font-size:12px;border-bottom:1px solid #999;font-weight:bold}';
        h += 'td{padding:4px 8px;border-bottom:1px solid #999;vertical-align:top;font-size:8px}';
        h += 'tr:nth-child(even) td{background:#f5f5f5}';
        h += '.mono{font-family:monospace}';
        h += '@media print{button{display:none}}';
        h += '</style></head><body>';
        h += '<h2>Manual Usage' + (manualNo ? ' — Manual ' + manualNo : '') + ' &mdash; ' + rows.length + '</h2>';
        h += '<p style="font-size:10px;color:#666;">Date Range: ' + dateLabel
            + (ignoreRange ? ' (ignored)' : '')
            + ' | Generated: ' + toDisplayDate(new Date())
            + (hasFallback ? ' | * = Created date used (shipped date not recovered)' : '') + '</p>';
        h += '<div style="margin-top:8px;margin-bottom:12px;display:flex;gap:8px;">';
        h += '<button onclick="window.print()" style="background:#378ADD;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Print</button>';
        h += '<button onclick="window.close()" style="background:#666;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Close</button>';
        h += '</div>';
        h += '<table><thead><tr>';
        h += '<th>#</th><th>Order</th><th>Component</th><th>Shipped Date</th><th>Manual Used</th>';
        h += '</tr></thead><tbody>';

        rows.forEach(function (r, i) {
            var shipStr = r.shippedDate
                ? (String(r.shippedDate.getDate()).padStart(2, '0') + '-' + MONTHS[r.shippedDate.getMonth()] + '-' + r.shippedDate.getFullYear())
                : '';
            h += '<tr>';
            h += '<td>' + (i + 1) + '</td>';
            h += '<td class="mono">' + String(r.order) + '</td>';
            h += '<td>' + String(r.component || '') + '</td>';
            h += '<td class="mono">' + shipStr + (r.fallback ? ' *' : '') + '</td>';
            h += '<td class="mono">' + String(r.manualUsed || '') + '</td>';
            h += '</tr>';
        });

        h += '</tbody></table>';
        h += '<p style="font-size:9px;color:#999;margin-top:12px;">Generated by AUDIT - Compliance Report Generator</p>';
        h += '</body></html>';
        showPrintout(h);
    }

    function exportManualInhouseExcel(rows, opts) {
        try {
            if (typeof XLSX === 'undefined') {
                showToast('Excel library (SheetJS) not loaded — check the userscript @require', 'warn');
                return;
            }
            opts = opts || {};
            var aoa = [['Manual', 'Manual LOC', 'Man. REV. INFO', 'Origin', 'Total']];
            rows.forEach(function (r) {
                aoa.push([r.manual, r.loc || '', r.revInfo || '', r.origin || '', r.total]);
            });
            aoa.push([]);
            aoa.push([opts.manualLabel || 'Orders with a manual', '', '', '',
                (opts.manualTotal != null) ? opts.manualTotal : rows.reduce(function (s, r) { return s + r.total; }, 0)]);
            if (opts.otherManual) aoa.push(['Orders with another manual', '', '', '', opts.otherManual]);
            aoa.push(['Orders with no manual', '', '', '', opts.noManual || 0]);
            aoa.push(['Grand total', '', '', '', opts.grandTotal || 0]);
            var ws = XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = [
                { wch: 10 }, { wch: 14 }, { wch: 40 }, { wch: 42 }, { wch: 8 }
            ];
            ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } }) };
            var wb = XLSX.utils.book_new();
            var sheetName = opts.fileBase || 'Manual Inhouse';
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
            var fname = 'AUDIT-' + sheetName + '-' + new Date().toISOString().slice(0, 10) + '.xlsx';
            XLSX.writeFile(wb, fname);
            showToast('Exported ' + rows.length + ' rows to ' + fname, 'success');
        } catch (e) {
            console.error('[AUDIT] Manual Inhouse export failed', e);
            showToast('Manual Inhouse export failed: ' + e.message, 'warn');
        }
    }

    function generateManualInhousePrintout(rows, opts) {
        opts = opts || {};
        var applyRange = !!opts.applyRange;
        var dateLabel = 'All time (no date filter)';
        if (applyRange) {
            var dates = getDateRange();
            if (dates.start && dates.end) {
                dateLabel = toDisplayDate(dates.start) + ' to ' + toDisplayDate(dates.end);
            } else if (dates.start) {
                dateLabel = 'From ' + toDisplayDate(dates.start);
            } else if (dates.end) {
                dateLabel = 'Up to ' + toDisplayDate(dates.end);
            } else {
                dateLabel = 'All dates';
            }
        }

        var title = opts.title || 'Manual Inhouse';

        var h = '<html><head><title>' + title + '</title><style>';
        h += 'body{font-family:Arial,sans-serif;font-size:8px;margin:20px}';
        h += 'table{border-collapse:collapse;width:100%;font-size:8px}';
        h += 'th{background:#fff;color:#000;padding:5px 8px;text-align:left;font-size:12px;border-bottom:1px solid #999;font-weight:bold}';
        h += 'td{border:1px solid #ccc;padding:4px 8px;vertical-align:top;font-size:8px}';
        h += 'tr:nth-child(even) td{background:#f5f5f5}';
        h += '.mono{font-family:monospace}';
        h += '@media print{button{display:none}}';
        h += '</style></head><body>';
        h += '<h2>' + title + ' &mdash; ' + rows.length + ' manuals</h2>';
        h += '<p style="font-size:10px;color:#666;">Orders by Created: ' + dateLabel
            + ' | Generated: ' + toDisplayDate(new Date()) + '</p>';
        h += '<div style="margin-top:8px;margin-bottom:12px;display:flex;gap:8px;">';
        h += '<button onclick="window.print()" style="background:#378ADD;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Print</button>';
        h += '<button onclick="window.close()" style="background:#666;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:12px;">Close</button>';
        h += '</div>';
        h += '<table><thead><tr>';
        h += '<th>#</th><th>Manual</th><th>Manual LOC</th><th>Man. REV. INFO</th><th>Origin</th><th>Total</th>';
        h += '</tr></thead><tbody>';

        rows.forEach(function (r, i) {
            h += '<tr>';
            h += '<td>' + (i + 1) + '</td>';
            h += '<td class="mono">' + String(r.manual) + '</td>';
            h += '<td>' + String(r.loc || '') + '</td>';
            h += '<td>' + String(r.revInfo || '') + '</td>';
            h += '<td>' + String(r.origin || '') + '</td>';
            h += '<td class="mono">' + r.total + '</td>';
            h += '</tr>';
        });

        h += '</tbody></table>';
        h += '<p style="font-size:10px;margin-top:8px;">' + (opts.manualLabel || 'Orders with a manual') + ': <b>'
            + (opts.manualTotal != null ? opts.manualTotal : rows.reduce(function (s, r) { return s + r.total; }, 0))
            + '</b>'
            + (opts.otherManual ? (' | Orders with another manual: <b>' + opts.otherManual + '</b>') : '')
            + ' | Orders with no manual: <b>' + (opts.noManual || 0)
            + '</b> | Grand total: <b>' + (opts.grandTotal || 0) + '</b></p>';
        h += '<p style="font-size:9px;color:#999;margin-top:12px;">Generated by AUDIT - Compliance Report Generator</p>';
        h += '</body></html>';
        showPrintout(h);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  MODAL
    // ═════════════════════════════════════════════════════════════════════════

    function closeModal() {
        var existing = document.getElementById(MODAL_ID);
        if (existing) existing.remove();
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  AUDITOR VIEW-ONLY MODE
    // ═════════════════════════════════════════════════════════════════════════
    // Password-gated read-only switch. ON: hides the app's Edit/Delete/Create
    // links + Kendo grid command buttons globally, and on Edit/Create/Add/Delete
    // pages disables the page's own form controls (belt-and-braces submit
    // catcher injected into page scope). OFF: editing restored. Client-side
    // only — a deterrent, not a server-side firewall.

    function auditorFallbackHash(s) {
        var h = 5381;
        for (var i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
        return 'f1:' + (h >>> 0).toString(16);
    }

    function auditorSha256(str) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
            var bytes = new Uint8Array(buf), hex = '';
            for (var i = 0; i < bytes.length; i++) hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
            return 's1:' + hex;
        });
    }

    function auditorHashFor(pw, salt) {
        var subtle = (window.crypto || globalThis.crypto || {}).subtle;
        if (subtle && subtle.digest) return auditorSha256(pw + salt);
        return Promise.resolve(auditorFallbackHash(pw + salt));
    }

    function auditorRandomSalt() {
        var a = new Uint8Array(16);
        (window.crypto || window.msCrypto).getRandomValues(a);
        var hex = '';
        for (var i = 0; i < a.length; i++) hex += (a[i] < 16 ? '0' : '') + a[i].toString(16);
        return hex;
    }

    function hasAuditorPassword() {
        return !!GM_getValue(AUDITOR_HASH_KEY, '');
    }

    function auditorModeOn() {
        return String(GM_getValue(AUDITOR_MODE_KEY, 'off')) === 'on';
    }

    function verifyAuditorPassword(pw) {
        var stored = GM_getValue(AUDITOR_HASH_KEY, '');
        if (!stored) return Promise.resolve(true); // nothing enrolled yet — first use enrolls
        var salt = GM_getValue(AUDITOR_SALT_KEY, '');
        var p = stored.indexOf('f1:') === 0
            ? Promise.resolve(auditorFallbackHash(pw + salt))
            : auditorSha256(pw + salt);
        return p.then(function (hash) { return hash === stored; });
    }

    function enrollAuditorPassword(pw) {
        var salt = auditorRandomSalt();
        return auditorHashFor(pw, salt).then(function (hash) {
            GM_setValue(AUDITOR_SALT_KEY, salt);
            GM_setValue(AUDITOR_HASH_KEY, hash);
        });
    }

    function setAuditorMode(on) {
        GM_setValue(AUDITOR_MODE_KEY, on ? 'on' : 'off');
        applyAuditorMode();
        showToast('Auditor View-Only ' + (on ? 'ENABLED - editing locked' : 'disabled - editing restored'),
            on ? 'warn' : 'success');
    }

    var AUDITOR_GUARD_ID = SCRIPT_ID + '-auditor-guard';

    function removeAuditorEditGuard() {
        var g = document.getElementById(AUDITOR_GUARD_ID);
        if (g) g.remove();
    }

    // On Edit/Create/Add/Delete screens disable the page's own form controls so
    // nothing can be changed even if the auditor lands on the page directly.
    function lockAuditorEditPages() {
        removeAuditorEditGuard();
        if (!auditorModeOn()) return;
        if (!/\/(Edit|Create|Add|Delete)[A-Za-z]*(\?|$|\/)/i.test(location.pathname)) return;
        document.querySelectorAll('body form').forEach(function (f) {
            f.querySelectorAll('input,select,textarea,button').forEach(function (el) {
                if (el.type === 'button' || el.type === 'reset') return;
                // text-ish fields: read-only (still viewable/selectable, not editable)
                if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) { el.disabled = true; return; }
                if (el.tagName === 'SELECT' || el.tagName === 'BUTTON') { el.disabled = true; return; }
                el.readOnly = true;
            });
        });
        // Order Edit page: comment box view-only; Send is a span (not caught above)
        var commentBox = document.getElementById('commentBox');
        if (commentBox) commentBox.readOnly = true;
        var commentBtn = document.getElementById('commentButton');
        if (commentBtn) { commentBtn.style.pointerEvents = 'none'; commentBtn.style.opacity = '0.5'; }
        // Order Edit page: Customer Portal comment box, Send span and upload input
        var custBox = document.getElementById('customerCommentBox');
        if (custBox) custBox.readOnly = true;
        var custBtn = document.getElementById('customerCommentButton');
        if (custBtn) { custBtn.style.pointerEvents = 'none'; custBtn.style.opacity = '0.5'; }
        var custFile = document.getElementById('customerSingleFiles');
        if (custFile) custFile.disabled = true;
        // order-line-area may live outside <form>; also make readonly inputs there inert
        var orderArea = document.getElementById('order-line-area');
        if (orderArea) {
            orderArea.querySelectorAll('input').forEach(function (el) {
                if (el.type === 'checkbox' || el.type === 'radio') { el.disabled = true; return; }
                el.readOnly = true;
            });
        }
        var guard = document.createElement('script');
        guard.id = AUDITOR_GUARD_ID;
        guard.textContent = 'window.__auditViewOnly__=true;document.addEventListener("submit",function(e){if(window.__auditViewOnly__){e.preventDefault();e.stopPropagation();}},true);';
        document.documentElement.appendChild(guard);
    }

    // AeroTools Edit links: icon-only ones (pencil column / tool-line actions) are
    // hidden; links with readable text (the LIB script's Tool Number hyperlinks)
    // become plain text so the value stays visible but can't open the Edit page.
    // Runs even when both scripts are installed on the same machine.
    function neutralizeAeroToolEditLinks() {
        if (!auditorModeOn()) return;
        document.querySelectorAll('a[href*="EditAeroTool"]').forEach(function (a) {
            if (a.__auditSafe) return;
            a.__auditSafe = true;
            if (a.querySelector('.glyphicon')) {
                a.style.setProperty('display', 'none', 'important');
            } else {
                var span = document.createElement('span');
                span.textContent = a.textContent;
                span.title = 'View only';
                a.parentNode.replaceChild(span, a);
            }
        });
    }

    // Catalog view pages (Documentation + AeroTool) each have a comment box +
    // Send button; auditor mode hides the widgets and makes postComment() a no-op.
    // Non-view pages are left alone (Order Edit keeps its read-only comment box).
    var auditorCommentNoop = function () { return false; };
    var auditorPostCommentOriginal = null;
    var auditorCommentWidgets = [];
    function neutralizeAuditorComments() {
        try {
            var target = window.unsafeWindow || window;
            if (auditorModeOn()) {
                if (typeof target.postComment === 'function' && target.postComment !== auditorCommentNoop && auditorPostCommentOriginal === null) {
                    auditorPostCommentOriginal = target.postComment;
                }
                try { target.postComment = auditorCommentNoop; } catch (e) {}
                if (/^\/Catalog\/(Documentations\/ViewDocumentation|AeroTools\/ViewAeroTool)|^\/Companies\//i.test(location.pathname)) {
                    ['commentBox', 'commentButton'].forEach(function (id) {
                        var el = document.getElementById(id);
                        if (el && auditorCommentWidgets.indexOf(el) === -1) {
                            auditorCommentWidgets.push(el);
                            el.__auditCommentDisplay = el.style.display || '';
                            el.style.setProperty('display', 'none', 'important');
                        }
                    });
                    var commentBox = document.getElementById('commentBox');
                    if (commentBox && commentBox.parentNode && commentBox.parentNode.classList && commentBox.parentNode.classList.contains('input-group')) {
                        var wrap = commentBox.parentNode;
                        if (auditorCommentWidgets.indexOf(wrap) === -1) {
                            auditorCommentWidgets.push(wrap);
                            wrap.__auditCommentDisplay = wrap.style.display || '';
                            wrap.style.setProperty('display', 'none', 'important');
                        }
                    }
                }
            } else if (auditorPostCommentOriginal || auditorCommentWidgets.length) {
                try { target.postComment = auditorPostCommentOriginal; } catch (e) {}
                auditorPostCommentOriginal = null;
                auditorCommentWidgets.forEach(function (el) {
                    if (el.__auditCommentDisplay !== undefined) {
                        el.style.display = el.__auditCommentDisplay;
                        delete el.__auditCommentDisplay;
                    }
                });
                auditorCommentWidgets = [];
            }
        } catch (e) {}
    }

    // Part List pages keep only the "Part List" tab; Categories / Tags / Import /
    // Export / BOM tabs are hidden (restored when mode is turned off).
    var auditorNavTabs = [];
    function neutralizeAuditorCatalogTabs() {
        try {
            if (auditorModeOn()) {
                if (/^\/Catalog\/Parts\/PartList/.test(location.pathname)) {
                    var hideTabs = [
                        '/Catalog/Parts/PartCategories', '/Catalog/Parts/Tags',
                        '/Catalog/Parts/ImportCatalog', '/Catalog/Parts/ExportCatalog',
                        '/Catalog/Parts/ImportBOMs', '/Catalog/Parts/ExportBOMs'
                    ];
                    document.querySelectorAll('ul.nav.nav-tabs li a[href]').forEach(function (a) {
                        if (hideTabs.indexOf(a.getAttribute('href')) === -1) return;
                        var li = a.parentNode;
                        if (li && auditorNavTabs.indexOf(li) === -1) {
                            auditorNavTabs.push(li);
                            li.__auditTabDisplay = li.style.display || '';
                            li.style.setProperty('display', 'none', 'important');
                        }
                    });
                }
            } else if (auditorNavTabs.length) {
                auditorNavTabs.forEach(function (li) {
                    if (li.__auditTabDisplay !== undefined) {
                        li.style.display = li.__auditTabDisplay;
                        delete li.__auditTabDisplay;
                    }
                });
                auditorNavTabs = [];
            }
        } catch (e) {}
    }

    // The LIB script re-renders the grid rows on dataBound, so re-check for new
    // Edit links whenever the DOM mutates while auditor mode is on.
    var auditorMutObs = null;
    function ensureAuditorMutObs() {
        if (auditorMutObs) return;
        auditorMutObs = new MutationObserver(function () {
            if (auditorModeOn()) {
                neutralizeAeroToolEditLinks();
                neutralizeAuditorComments();
                neutralizeAuditorCatalogTabs();
            }
        });
        auditorMutObs.observe(document.documentElement, { childList: true, subtree: true });
    }

    // The navbar is pushed down 22px (banner) but the page's own top padding only
    // clears the ORIGINAL navbar position, so content can slide under it. Set the
    // body's top padding to the navbar's measured bottom + a gap instead of a fixed
    // guess, so nothing hides regardless of where the real clearance lives.
    var auditorPadResizeBound = false;
    function adjustAuditorBodyPad(on) {
        var body = document.body;
        if (!body) return;
        if (on) {
            if (body.__auditBodyPadSaved === undefined) body.__auditBodyPadSaved = body.style.paddingTop || '';
            var nav = document.querySelector('.navbar-fixed-top');
            var bottom = nav ? nav.getBoundingClientRect().bottom : 0;
            body.style.paddingTop = (bottom > 22 ? bottom + 8 : (parseFloat(getComputedStyle(body).paddingTop) || 0) + 22) + 'px';
            if (!auditorPadResizeBound) {
                auditorPadResizeBound = true;
                window.addEventListener('resize', function () {
                    if (auditorModeOn()) adjustAuditorBodyPad(true);
                });
            }
        } else if (body.__auditBodyPadSaved !== undefined) {
            body.style.paddingTop = body.__auditBodyPadSaved;
            delete body.__auditBodyPadSaved;
        }
    }

    // The order/quote pages have a second floating header (.sticky) pinned under
    // the navbar. It does not move with the navbar, so shift its `top` down by
    // the banner height too, otherwise it slides under the pushed-down navbar.
    function adjustAuditorStickyTop(on) {
        document.querySelectorAll('.sticky').forEach(function (el) {
            if (on) {
                if (el.__auditStickyTopSaved === undefined) {
                    el.__auditStickyTopSaved = el.style.top || '';
                    var ct = parseFloat(getComputedStyle(el).top);
                    if (!isNaN(ct)) el.style.top = (ct + 22) + 'px';
                }
            } else if (el.__auditStickyTopSaved !== undefined) {
                el.style.top = el.__auditStickyTopSaved;
                delete el.__auditStickyTopSaved;
            }
        });
    }

    // The banner sits at the very top in view; the app's fixed-top navbar is
    // pushed down below it (see CSS rule .navbar-fixed-top{top:22px!important}),
    // so the nav links are never covered.

    // Applies / removes the view-only overlay + edit hiding. Id-isolated so it
    // is safe to call repeatedly (page reload, toggle, re-init).
    function applyAuditorMode() {
        try {
            var css = document.getElementById(AUDITOR_CSS_ID);
            var banner = document.getElementById(AUDITOR_CSS_ID + '-banner');
            if (auditorModeOn()) {
                if (!css) {
                    css = document.createElement('style');
                    css.id = AUDITOR_CSS_ID;
                    css.textContent = [
                        // Group 1: universal delete / create / add links + Kendo grid tools
                        'a[href*="/Delete"],a[href*="/delete"],a[href*="/Create"],a[href*="/create"],',
                        'a[href*="/Add"],a[href*="/add"],',
                        '.k-grid-delete,.k-grid-remove,.k-grid-add,.k-grid-save-changes',
                        '{display:none !important;pointer-events:none !important;}',
                        // Group 2: Order Edit page - toolbar + jumping-off buttons
                        '.order-action-toolbar,',
                        'button[onclick*="refreshOrderHeader"],button[onclick*="addPartFromSearch"],',
                        'a[href*="/Orders/Orders/ScheduleEvents"],',
                        'a[href*="/Reports/OrderLineBreakdownReport"],',
                        'a[href*="/TimeTracking/ServiceTimeTracking"]',
                        '{display:none !important;pointer-events:none !important;}',
                        // Group 3: Order Edit page - line/part/service/component + portal buttons
                        'button[onclick*="addComponent"],button[onclick*="addNewLine"],button[onclick*="addNewServiceLine"],',
                        'button[onclick*="lockComponents"],button[onclick*="newRQ"],button[onclick*="submitAllPOs"],',
                        'a[href*="handler=DownloadAeroFile"],',
                        'a[href*="/Orders/Receiving/PerformServices"],a[href*="/Orders/Shipping/CreateFulfillment"],',
                        'a[href*="/Orders/Invoicing/ProgressInvoice"],a[href*="/Orders/Invoicing/AdvanceInvoice"],',
                        '.k-upload,button[onclick*="openCreateNewSelection"]',
                        '{display:none !important;pointer-events:none !important;}',
                        // Group 4: Catalog pages - parts / categories / services / BoM edit + create
                        'a[href*="/Catalog/Parts/PartList/Edit"],',
                        'a[href*="/Catalog/Parts/PartCategories/Edit"],',
                        'a[href*="/Catalog/Services/ServiceList/Edit"],',
                        'a[href*="handler=CreateBoM"],',
                        'a[href*="EditDocumentation"]',
                        '{display:none !important;pointer-events:none !important;}',
                        // Group 5: Purchase Order / Quote pages - edit-info, save/status, line removal
                        'button[onclick*="cancelRemaining"],button[onclick*="refreshPoHeader"],',
                        'button[onclick*="refreshQuoteHeader"],button[onclick*="saveAllQuoteChanges"],',
                        'button[onclick*="quoteSubmitted"],button[onclick*="quoteWon"],',
                        'button[onclick*="quoteLost"],button[onclick*="quoteCancelled"],',
                        'button[onclick*="checkSendGridSetup"],button[onclick*="removeLine"]',
                        '{display:none !important;pointer-events:none !important;}',
                        // Group 6: Job order / Inventory / docs bulk-edit / order actions
                        'a[href*="CreateJobOrder"],button[onclick*="removeDoc"],a[onclick*="newAdjust"],',
                        'a[href*="/Orders/Orders/Clone"],',
                        'button[onclick*="addCurrentVendorsVisibility"],button[onclick*="openEditOrderDocument"],',
                        '.print-options-button,',
                        '#bulk-edit-btn',
                        '{display:none !important;pointer-events:none !important;}',
                        // Group 7: nav top-level anchors (survey/notifications/time/search links)
                        'a[onclick*="getNotifications"],',
                        'a[href="/Schedule/ScheduleOverview"],a[href="/TimeTracking/Index"],a[href="/Search/Index"]',
                        '{display:none !important;pointer-events:none !important;}',
                        // Group 8: nav dropdowns we keep open - hide specific menu item links
                        'a[href="/Orders/Quotes"],a[href="/Orders/Jobs/JobOrders"],a[href="/Orders/Returns"],',
                        'a[href="/Orders/Receiving"],a[href="/Orders/Receiving/Receipts"],',
                        'a[href="/Orders/Shipping/ReadyToFulfill"],a[href="/Orders/Shipping/Fulfillments"],',
                        'a[href="/Orders/Shipping/ReadyToShip"],a[href="/Orders/Shipping/Shipments"],',
                        'a[href="/Inventory/MoveTickets"],a[href="/Locations/Warehouse"],',
                        'a[href="/Catalog/Services/ServiceList"]',
                        '{display:none !important;pointer-events:none !important;}',
                        // Auditor mode: full top-level nav items hidden (:has() rule, isolated).
                        '.navbar-fixed-top li:has(span.name-plate),.navbar-fixed-top li:has(span.glyphicon-cog),',
                        '.navbar-fixed-top li:has(span.glyphicon-bell),.navbar-fixed-top li:has(a[onclick*="getNotifications"]),',
                        '.navbar-fixed-top li:has(a[href*="/Reports/"]),.navbar-fixed-top li:has(a[href*="/Companies/"]),',
                        '.navbar-fixed-top li:has(a[href*="/Orders/Billing/"]),',
                        '.navbar-fixed-top li:has(a[href="/Schedule/ScheduleOverview"]),',
                        '.navbar-fixed-top li:has(a[href="/TimeTracking/Index"]),',
                        '.navbar-fixed-top li:has(a[href="/Search/Index"])',
                        '{display:none !important;pointer-events:none !important;}',
                        // Auditor mode: keep these dropdowns but hide specific menu items
                        // (:has() rule, isolated).
                        '.navbar-fixed-top .dropdown-menu li:has(a[href="/Orders/Quotes"]),',
                        '.navbar-fixed-top .dropdown-menu li:has(a[href="/Orders/Jobs/JobOrders"]),',
                        '.navbar-fixed-top .dropdown-menu li:has(a[href="/Orders/Returns"]),',
                        '.navbar-fixed-top .dropdown-menu li:has(a[href="/Orders/Receiving"]),',
                        '.navbar-fixed-top .dropdown-menu li:has(a[href="/Orders/Receiving/Receipts"]),',
                        '.navbar-fixed-top .dropdown-menu li:has(a[href="/Orders/Shipping/ReadyToFulfill"]),',
                        '.navbar-fixed-top .dropdown-menu li:has(a[href="/Orders/Shipping/Fulfillments"]),',
                        '.navbar-fixed-top .dropdown-menu li:has(a[href="/Orders/Shipping/ReadyToShip"]),',
                        '.navbar-fixed-top .dropdown-menu li:has(a[href="/Orders/Shipping/Shipments"]),',
                        '.navbar-fixed-top .dropdown-menu li:has(a[href="/Inventory/MoveTickets"]),',
                        '.navbar-fixed-top .dropdown-menu li:has(a[href="/Locations/Warehouse"]),',
                        '.navbar-fixed-top .dropdown-menu li:has(a[href="/Catalog/Services/ServiceList"])',
                        '{display:none !important;pointer-events:none !important;}',
                        // Blanket rule: a pencil glyphicon means "edit" - hide it anywhere.
                        // Kept as its own rule so an unsupported :has() can't invalidate the
                        // main hide-list above.
                        'a:has(span.glyphicon-pencil),button:has(span.glyphicon-pencil){display:none !important;pointer-events:none !important;}',
                        // Order Edit page: line items + progress + customer portal stay fully
                        // visible but nothing is clickable
                        '.lq-rounded-table-wrapper,#ProgressArea,#collapseCustomerDocs{pointer-events:none!important;-webkit-user-select:text!important;user-select:text!important;}',
                        // PO Edit page: parts line table + Receive/Perform + Submit-to-Vendor
                        // blocks stay fully visible but nothing is clickable
                        '#PORowsSection,#receiveOptions,#submitOptions{pointer-events:none!important;-webkit-user-select:text!important;user-select:text!important;}',
                        // Push the fixed navbar down below the top banner so nav links
                        // stay fully visible and clickable (banner is 22px tall)
                        '.navbar-fixed-top{top:22px!important;}'
                    ].map(function (s) {
                        return s.indexOf('//') === 0 ? '/* ' + s.slice(2) + ' */' : s;
                    }).join('');
                    document.head.appendChild(css);
                }
                if (!banner && document.body) {
                    banner = document.createElement('div');
                    banner.id = AUDITOR_CSS_ID + '-banner';
                    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;'
                        + 'background:rgba(192,57,43,0.88);color:#fff;font:600 10px/22px Roboto,sans-serif;'
                        + 'text-align:center;letter-spacing:1.5px;text-transform:uppercase;';
                    banner.textContent = 'VIEW ONLY - AUDITOR MODE';
                    document.body.appendChild(banner);
                }
                adjustAuditorBodyPad(true);
                adjustAuditorStickyTop(true);
                neutralizeAeroToolEditLinks();
                neutralizeAuditorComments();
                neutralizeAuditorCatalogTabs();
                ensureAuditorMutObs();
            } else {
                if (css) css.remove();
                if (banner) banner.remove();
                removeAuditorEditGuard();
                neutralizeAuditorComments();
                neutralizeAuditorCatalogTabs();
                adjustAuditorBodyPad(false);
                adjustAuditorStickyTop(false);
                if (auditorMutObs) { auditorMutObs.disconnect(); auditorMutObs = null; }
            }
            lockAuditorEditPages();
        } catch (e) {
            console.error('[AUDIT] applyAuditorMode failed', e);
        }
    }

    // Password prompt dialog for toggling Auditor View-Only on/off. First use
    // (no password enrolled yet) captures the entered password as the master.
    function askAuditorPassword(action, cb) {
        var existing = document.getElementById(SCRIPT_ID + '-auditor-pw');
        if (existing) existing.remove();

        var on = action === 'on';
        var overlay = document.createElement('div');
        overlay.id = SCRIPT_ID + '-auditor-pw';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000000;'
            + 'display:flex;align-items:center;justify-content:center;';

        var box = document.createElement('div');
        box.style.cssText = 'background:#fff;color:#333;border-radius:6px;padding:20px 24px;width:380px;'
            + 'max-width:92vw;box-shadow:0 6px 24px rgba(0,0,0,0.3);font-family:Roboto,sans-serif;';

        var heading = document.createElement('div');
        heading.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:6px;color:#333;';
        heading.textContent = on ? 'Enable Auditor View-Only' : 'Disable Auditor View-Only';
        box.appendChild(heading);

        var msg = document.createElement('div');
        msg.style.cssText = 'font-size:12px;color:#666;margin-bottom:12px;line-height:1.5;';
        msg.innerHTML = hasAuditorPassword()
            ? 'Enter the Auditor password to ' + (on ? 'turn on' : 'turn off') + ' view-only mode.'
            : 'No Auditor password is set yet &mdash; enter one now to secure the switch (you&rsquo;ll need it to toggle off).';
        box.appendChild(msg);

        var input = document.createElement('input');
        input.type = 'password';
        input.placeholder = 'Auditor password';
        input.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #ccc;'
            + 'border-radius:4px;font-size:14px;';
        box.appendChild(input);

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px;';

        var okBtn = document.createElement('button');
        okBtn.textContent = 'Confirm';
        okBtn.style.cssText = 'background:#378ADD;color:#fff;border:none;padding:8px 16px;border-radius:4px;'
            + 'cursor:pointer;font-size:13px;font-weight:600;';

        var cancel = document.createElement('button');
        cancel.textContent = 'Cancel';
        cancel.style.cssText = 'background:#6c757d;color:#fff;border:none;padding:8px 16px;border-radius:4px;'
            + 'cursor:pointer;font-size:13px;';

        row.appendChild(cancel);
        row.appendChild(okBtn);
        box.appendChild(row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function close() { overlay.remove(); }

        function submit() {
            var pw = input.value;
            if (!pw) { input.focus(); return; }
            okBtn.disabled = true;
            verifyAuditorPassword(pw).then(function (okay) {
                if (!okay) {
                    okBtn.disabled = false;
                    msg.innerHTML = '<span style="color:#c0392b;font-weight:600;">Incorrect password.</span> Try again.';
                    input.value = '';
                    input.focus();
                    return;
                }
                var finish = function () {
                    close();
                    cb(true);
                    setAuditorMode(on);
                };
                if (hasAuditorPassword()) {
                    finish();
                } else {
                    enrollAuditorPassword(pw).then(finish).catch(function () {
                        okBtn.disabled = false;
                        msg.textContent = 'Could not store the password. Try again.';
                    });
                }
            });
        }

        cancel.addEventListener('click', function () { close(); cb(false); });
        okBtn.addEventListener('click', submit);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
        input.focus();
    }

    // Change-password dialog: verify current (when one exists), then enroll the
    // new one. Usable before the first enable too (then it just sets a password).
    function askAuditorChangePassword() {
        var existing = document.getElementById(SCRIPT_ID + '-auditor-pw');
        if (existing) existing.remove();

        var hasPw = hasAuditorPassword();
        var overlay = document.createElement('div');
        overlay.id = SCRIPT_ID + '-auditor-pw';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000000;'
            + 'display:flex;align-items:center;justify-content:center;';

        var box = document.createElement('div');
        box.style.cssText = 'background:#fff;color:#333;border-radius:6px;padding:20px 24px;width:380px;'
            + 'max-width:92vw;box-shadow:0 6px 24px rgba(0,0,0,0.3);font-family:Roboto,sans-serif;';

        var heading = document.createElement('div');
        heading.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:6px;color:#333;';
        heading.textContent = hasPw ? 'Change Auditor password' : 'Set Auditor password';
        box.appendChild(heading);

        var msg = document.createElement('div');
        msg.style.cssText = 'font-size:12px;color:#666;margin-bottom:12px;line-height:1.5;';
        msg.textContent = hasPw
            ? 'Enter the current password, then the new one (both confirmation fields must match).'
            : 'No password set yet &mdash; enter the one to secure the switch.';
        msg.innerHTML = msg.textContent;
        box.appendChild(msg);

        function field(ph) {
            var i = document.createElement('input');
            i.type = 'password';
            i.placeholder = ph;
            i.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #ccc;'
                + 'border-radius:4px;font-size:14px;margin-bottom:8px;';
            return i;
        }

        var cur = null;
        if (hasPw) {
            cur = field('Current password');
            box.appendChild(cur);
        }
        var nw = field('New password');
        box.appendChild(nw);
        var conf = field('Confirm new password');
        box.appendChild(conf);

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:6px;';

        var okBtn = document.createElement('button');
        okBtn.textContent = 'Save';
        okBtn.style.cssText = 'background:#378ADD;color:#fff;border:none;padding:8px 16px;border-radius:4px;'
            + 'cursor:pointer;font-size:13px;font-weight:600;';

        var cancel = document.createElement('button');
        cancel.textContent = 'Cancel';
        cancel.style.cssText = 'background:#6c757d;color:#fff;border:none;padding:8px 16px;border-radius:4px;'
            + 'cursor:pointer;font-size:13px;';

        row.appendChild(cancel);
        row.appendChild(okBtn);
        box.appendChild(row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function close() { overlay.remove(); }

        function submit() {
            var done = function () {
                close();
                showToast('Auditor password updated. Use it to toggle View-Only on/off.', 'success');
            };
            if (hasPw) {
                verifyAuditorPassword(cur.value).then(function (okay) {
                    if (!okay) {
                        msg.innerHTML = '<span style="color:#c0392b;font-weight:600;">Incorrect current password.</span>';
                        cur.value = '';
                        cur.focus();
                        return;
                    }
                    proceed();
                });
            } else {
                proceed();
            }
            function proceed() {
                if (!nw.value) {
                    msg.innerHTML = '<span style="color:#c0392b;font-weight:600;">Please enter a new password.</span>';
                    nw.focus();
                    return;
                }
                if (nw.value !== conf.value) {
                    msg.innerHTML = '<span style="color:#c0392b;font-weight:600;">Passwords do not match.</span>';
                    conf.value = '';
                    conf.focus();
                    return;
                }
                okBtn.disabled = true;
                enrollAuditorPassword(nw.value).then(done).catch(function () {
                    okBtn.disabled = false;
                    msg.textContent = 'Could not store the password. Try again.';
                });
            }
        }

        cancel.addEventListener('click', close);
        okBtn.addEventListener('click', submit);
        var fields = [cur, nw, conf].filter(Boolean);
        fields.forEach(function (f) { f.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); }); });
        if (fields.length) fields[0].focus();
    }

    function buildAuditorToggle() {
        var row = document.createElement('div');
        row.className = 'auditor-row';

        var info = document.createElement('div');
        var label = document.createElement('div');
        label.className = 'auditor-label';
        label.textContent = 'Auditor View-Only';
        var desc = document.createElement('div');
        desc.className = 'auditor-desc';
        desc.textContent = 'Hides all Edit / Save / Delete controls on every page.';
        info.appendChild(label);
        info.appendChild(desc);

        var right = document.createElement('div');
        right.style.cssText = 'display:flex;align-items:center;gap:8px;';

        var state = document.createElement('span');
        state.className = 'auditor-state';

        var btn = document.createElement('button');
        btn.className = 'auditor-toggle';

        var chg = document.createElement('button');
        chg.className = 'auditor-toggle off';
        chg.textContent = 'Change password';
        chg.title = 'Update the Auditor password';
        chg.addEventListener('click', askAuditorChangePassword);

        function refresh() {
            var on = auditorModeOn();
            state.className = 'auditor-state ' + (on ? 'on' : 'off');
            state.textContent = on ? 'VIEW ONLY ON' : 'VIEW ONLY OFF';
            btn.textContent = on ? 'Disable' : 'Enable';
            btn.className = 'auditor-toggle' + (on ? '' : ' off');
        }

        btn.addEventListener('click', function () {
            var on = auditorModeOn();
            askAuditorPassword(on ? 'off' : 'on', function (okay) { if (okay) refresh(); });
        });

        refresh();
        right.appendChild(state);
        right.appendChild(btn);
        right.appendChild(chg);
        row.appendChild(info);
        row.appendChild(right);
        return row;
    }

    function openModal() {
        closeModal();

        var overlay = document.createElement('div');
        overlay.id = MODAL_ID;

        var box = document.createElement('div');
        box.className = 'audit-box';

        // ── Top-right Close button ──
        var topCloseBtn = document.createElement('button');
        topCloseBtn.textContent = '×';
        topCloseBtn.style.cssText = 'position:absolute;top:8px;right:12px;width:28px;height:28px;border:none;background:#e74c3c;color:#fff;border-radius:50%;font-size:18px;line-height:24px;cursor:pointer;z-index:10;opacity:0.8;transition:opacity .15s;';
        topCloseBtn.title = 'Close';
        topCloseBtn.addEventListener('click', closeModal);
        topCloseBtn.addEventListener('mouseenter', function () { this.style.opacity = '1'; });
        topCloseBtn.addEventListener('mouseleave', function () { this.style.opacity = '0.8'; });
        box.appendChild(topCloseBtn);

        // ── Title ──
        var title = document.createElement('h2');
        title.textContent = 'Audit Console';
        box.appendChild(title);

        var subtitle = document.createElement('div');
        subtitle.className = 'subtitle';
        subtitle.textContent = new Date().toLocaleString() + ' | ' + location.hostname;
        box.appendChild(subtitle);

        box.appendChild(buildAuditorToggle());

        // ── Date Range ──
        var filterRow = document.createElement('div');
        filterRow.className = 'filter-row';

        var startGroup = document.createElement('div');
        startGroup.className = 'filter-group';
        startGroup.innerHTML = '<label>From</label>';
        var startInput = document.createElement('input');
        startInput.id = SCRIPT_ID + '-date-start';
        startInput.type = 'text';
        startInput.placeholder = 'dd-mmm-yyyy';
        startGroup.appendChild(startInput);
        filterRow.appendChild(startGroup);

        var endGroup = document.createElement('div');
        endGroup.className = 'filter-group';
        endGroup.innerHTML = '<label>To</label>';
        var endInput = document.createElement('input');
        endInput.id = SCRIPT_ID + '-date-end';
        endInput.type = 'text';
        endInput.placeholder = 'dd-mmm-yyyy';
        endGroup.appendChild(endInput);
        filterRow.appendChild(endGroup);

        box.appendChild(filterRow);

        // ── Category Checkboxes ──
        var catRow = document.createElement('div');
        catRow.className = 'cat-row';

        var catLabel = document.createElement('span');
        catLabel.className = 'cat-label';
        catLabel.textContent = 'Categories:';
        catRow.appendChild(catLabel);

        CATEGORIES.forEach(function (cat) {
            var chip = document.createElement('span');
            chip.className = 'cat-chip active';
            chip.dataset.cat = cat;
            chip.style.cursor = 'pointer';

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = true;
            chip.appendChild(cb);
            chip.appendChild(document.createTextNode(cat));

            chip.addEventListener('click', function (e) {
                if (e.target === cb) return;
                cb.checked = !cb.checked;
                chip.classList.toggle('active', cb.checked);
            });

            cb.addEventListener('change', function () {
                chip.classList.toggle('active', cb.checked);
            });

            catRow.appendChild(chip);
        });

        // "Mismatched / Missing" pseudo-chip: missing cost center or a code that
        // isn't a real cost center (typo). Off by default; the units themselves
        // always appear in the report regardless. Selecting it alone focuses the
        // report on just the missing/mismatched units.
        var missingChip = document.createElement('span');
        missingChip.className = 'cat-chip missing-chip active';
        missingChip.dataset.cat = CATEGORY_MISSING;
        missingChip.style.cursor = 'pointer';

        var missingCb = document.createElement('input');
        missingCb.type = 'checkbox';
        missingCb.checked = true;
        missingChip.appendChild(missingCb);
        missingChip.appendChild(document.createTextNode('Mismatched / Missing'));

        missingChip.addEventListener('click', function (e) {
            if (e.target === missingCb) return;
            missingCb.checked = !missingCb.checked;
            missingChip.classList.toggle('active', missingCb.checked);
        });

        missingCb.addEventListener('change', function () {
            missingChip.classList.toggle('active', missingCb.checked);
        });

        catRow.appendChild(missingChip);

        box.appendChild(catRow);

        // ── Office Checkboxes (page #officeSelect multiselect mirrors these) ──
        var officeRow = document.createElement('div');
        officeRow.className = 'cat-row';

        var officeLabel = document.createElement('span');
        officeLabel.className = 'cat-label';
        officeLabel.textContent = 'Offices:';
        officeRow.appendChild(officeLabel);

        var officeDefault = (pendingFilters && pendingFilters.offices)
            ? pendingFilters.offices.slice()
            : [OFFICES[0].value];
        getOfficeOptions().forEach(function (office) {
            var chip = document.createElement('span');
            chip.className = 'office-chip' + (officeDefault.indexOf(office.value) !== -1 ? ' active' : '');
            chip.dataset.value = office.value;
            chip.style.cursor = 'pointer';

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = chip.classList.contains('active');
            chip.appendChild(cb);
            chip.appendChild(document.createTextNode(office.text));

            chip.addEventListener('click', function (e) {
                if (e.target === cb) return;
                cb.checked = !cb.checked;
                chip.classList.toggle('active', cb.checked);
            });

            cb.addEventListener('change', function () {
                chip.classList.toggle('active', cb.checked);
            });

            officeRow.appendChild(chip);
        });

        box.appendChild(officeRow);

        // ── Controlled Goods filter ──
        var cgRow = document.createElement('div');
        cgRow.className = 'cat-row';

        var cgLabel = document.createElement('span');
        cgLabel.className = 'cat-label';
        cgLabel.textContent = 'Controlled Goods:';
        cgRow.appendChild(cgLabel);

        var cgChip = document.createElement('span');
        cgChip.className = (getControlledGoods() ? 'cg-chip active' : 'cg-chip');
        cgChip.style.cursor = 'pointer';

        var cgCb = document.createElement('input');
        cgCb.type = 'checkbox';
        cgCb.id = SCRIPT_ID + '-controlled-goods';
        cgCb.checked = getControlledGoods();
        cgChip.appendChild(cgCb);
        cgChip.appendChild(document.createTextNode('Bell Helicopters Textron'));

        cgChip.addEventListener('click', function (e) {
            if (e.target === cgCb) return;
            cgCb.checked = !cgCb.checked;
            cgChip.classList.toggle('active', cgCb.checked);
        });

        cgCb.addEventListener('change', function () {
            cgChip.classList.toggle('active', cgCb.checked);
        });

        cgRow.appendChild(cgChip);
        box.appendChild(cgRow);

        // ── Order Rep filter (Work Orders report) ──
        // Single-select dropdown of ENABLED reps from the app's User list
        // (/Identity/Users?handler=ApplicationUsers), restricted to email domains
        // matching the selected offices (Bristow -> @bristow.ca, VSI YYC -> @vi-scan.com),
        // plus an "Exclude Front End" checkbox that's on by default. Picking a rep
        // shows only their rows; otherwise front-end staff are filtered out.
        var repRow = document.createElement('div');
        repRow.className = 'cat-row';

        var repLabel = document.createElement('span');
        repLabel.className = 'cat-label';
        repLabel.textContent = 'Order Rep:';
        repRow.appendChild(repLabel);

        var repCol = document.createElement('span');
        repCol.style.cssText = 'display:inline-flex;flex-direction:column;gap:6px;align-items:flex-start;';

        var repSelect = document.createElement('select');
        repSelect.id = SCRIPT_ID + '-rep-select';
        repSelect.style.cssText = 'width:280px;max-width:100%;border:1px solid #ccc;border-radius:4px;padding:5px 8px;font-size:12px;background:#fff;color:#333;';

        var repExcl = document.createElement('label');
        repExcl.style.cssText = 'display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12px;color:#666;';
        var repExclCb = document.createElement('input');
        repExclCb.type = 'checkbox';
        repExclCb.id = SCRIPT_ID + '-exclude-front-end';
        repExclCb.checked = (pendingFilters && typeof pendingFilters.excludeFrontEnd === 'boolean')
            ? pendingFilters.excludeFrontEnd
            : true;
        repExcl.appendChild(repExclCb);
        repExcl.appendChild(document.createTextNode('Exclude front-end staff'));

        repCol.appendChild(repSelect);
        repCol.appendChild(repExcl);
        repRow.appendChild(repCol);
        box.appendChild(repRow);

        // Repopulates the dropdown from the fetched Users list (enabled users;
        // only @vi-scan.com when JUST the VSI YYC Base office is selected)
        // and preserves the current pick.
        function populateRepSelect() {
            var prev = repSelect.value || '';
            repSelect.innerHTML = '';
            var opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'All reps';
            repSelect.appendChild(opt);

            if (Array.isArray(USERS)) {
                // Office chips drive the list, strictly by email domain:
                //   VSI YYC Base  -> @vi-scan.com users only
                //   Bristow bases (YEG/YLW) -> @bristow.ca users only
                //   Other domains are OMITTED. No office chips selected -> all
                //   enabled users (no domain filter).
                var offices = getSelectedOffices();
                var domainFilter = {};
                if (offices.length > 0) {
                    offices.forEach(function (v) {
                        domainFilter[isVsiOffice(v) ? 'vi-scan.com' : 'bristow.ca'] = true;
                    });
                }
                var hasDomainFilter = Object.keys(domainFilter).length > 0;
                var nameCount = {};
                USERS.forEach(function (u) {
                    if (u.enabled && u.fullName) {
                        var key = normalizeName(u.fullName);
                        nameCount[key] = (nameCount[key] || 0) + 1;
                    }
                });
                USERS.filter(function (u) {
                    if (!u.enabled || !u.fullName) return false;
                    if (hasDomainFilter) {
                        var dom = String(u.email || '').split('@').pop().toLowerCase();
                        if (!domainFilter[dom]) return false;
                    }
                    return true;
                })
                .sort(function (a, b) { return a.fullName.localeCompare(b.fullName); })
                .forEach(function (u) {
                    var o = document.createElement('option');
                    o.value = u.fullName;
                    o.textContent = u.fullName
                        + (nameCount[normalizeName(u.fullName)] > 1 ? '  <' + u.email + '>' : '');
                    repSelect.appendChild(o);
                });
            }

            var pend = (pendingFilters && pendingFilters.selectedRep) || '';
            var want = prev || pend;
            var found = false;
            for (var i = 0; i < repSelect.options.length; i++) {
                if (repSelect.options[i].value === want) {
                    repSelect.value = want;
                    found = true;
                    break;
                }
            }
            if (!found) repSelect.value = '';
        }

        // Repopulate when the office selection changes (office chips built above).
        officeRow.querySelectorAll('.office-chip').forEach(function (chip) {
            var cb = chip.querySelector('input[type=checkbox]');
            if (cb) cb.addEventListener('change', populateRepSelect);
            chip.addEventListener('click', populateRepSelect);
        });

        populateRepSelect();
        fetchUsers().then(function () { populateRepSelect(); });


        var cacheSection = document.createElement('details');
        cacheSection.style.cssText = 'background:#f8f9fa;border:1px solid #e0e0e0;border-radius:4px;padding:8px 12px;margin-bottom:12px;';

        var cacheSummary = document.createElement('summary');
        cacheSummary.style.cssText = 'cursor:pointer;font-size:12px;font-weight:600;color:#555;list-style:none;display:flex;align-items:center;gap:6px;user-select:none;';
        cacheSummary.innerHTML = '<span class="cache-caret" style="display:inline-block;transition:transform .15s;">&#9656;</span> Cache Tools';
        cacheSection.appendChild(cacheSummary);
        cacheSection.addEventListener('toggle', function () {
            var caret = cacheSummary.querySelector('.cache-caret');
            if (caret) caret.style.transform = cacheSection.open ? 'rotate(90deg)' : 'rotate(0deg)';
        });

        var cacheBody = document.createElement('div');
        cacheBody.style.cssText = 'margin-top:8px;';

        var cacheHeader = document.createElement('div');
        cacheHeader.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;';

        var refreshBtn = document.createElement('button');
        refreshBtn.id = SCRIPT_ID + '-refresh-cache';
        refreshBtn.textContent = 'Force Rebuild Cache';
        refreshBtn.title = 'Wipe the Cost Center + Warranty + Sub-Contract + History + Manual caches so the next run re-fetches everything from scratch (fixes stale results, e.g. a bad earlier parse). Click, then re-run the report.';
        refreshBtn.style.cssText = 'background:#d9534f;color:#fff;border:none;border-radius:3px;padding:3px 8px;font-size:11px;cursor:pointer;';
        refreshBtn.addEventListener('click', function () {
            clearCCCache();
            clearWarrantyCache();
            clearSubcontractCache();
            clearHistCache();
            clearManualCache();
            showToast('All caches cleared — re-run the report to rebuild from scratch', 'success');
            var ci = document.getElementById(SCRIPT_ID + '-cache-info');
            if (ci) ci.textContent = 'Cache: cleared (will rebuild on next run)';
        });

        var precacheBtn = document.createElement('button');
        precacheBtn.textContent = 'Pre-cache Completed/Shipped';
        precacheBtn.title = 'Warm the Cost Center cache for completed & shipped orders in the date range above, without generating a report';
        precacheBtn.style.cssText = 'background:#378ADD;color:#fff;border:none;border-radius:3px;padding:3px 8px;font-size:11px;cursor:pointer;';
        precacheBtn.addEventListener('click', function () { precacheCompletedShippedOrders(); });

        var refreshCcBtn = document.createElement('button');
        refreshCcBtn.textContent = 'Refresh Cost Centers';
        refreshCcBtn.title = 'Clear ONLY the cost-center (and its free Warranty/Sub-Contract) cache so edits to Cost Center show up on the next run — fast; does NOT touch the slow history scan';
        refreshCcBtn.style.cssText = 'background:#fff;border:1px solid #f0ad4e;color:#8a6d3b;border-radius:3px;padding:3px 8px;font-size:11px;cursor:pointer;';
        refreshCcBtn.addEventListener('click', function () {
            clearCCCache();
            showToast('Cost Center cache cleared — next Work Orders run will re-fetch them', 'success');
            var ci = document.getElementById(SCRIPT_ID + '-cache-info');
            if (ci) ci.textContent = 'Cache: cleared (will rebuild on next run)';
        });

        var outlineBtn = 'background:#fff;border:1px solid #ccc;border-radius:3px;padding:3px 8px;font-size:11px;cursor:pointer;color:#555;';

        var backupDlBtn = document.createElement('button');
        backupDlBtn.textContent = 'Download All Cache';
        backupDlBtn.title = 'Save every cache (cost centers, warranty/subcontract, shipped-date history, manuals, PO, Origin + REV INFO) and your Excluded Vendors / PO Removed Rows rules into ONE file';
        backupDlBtn.style.cssText = outlineBtn;
        backupDlBtn.addEventListener('click', function () { downloadAllCache(); });

        var backupLoadBtn = document.createElement('button');
        backupLoadBtn.textContent = 'Load All Cache';
        backupLoadBtn.title = 'Load a file saved by Download All Cache (or any older cache / history / PO / origin / settings file). Merges into what is already here; nothing is deleted.';
        backupLoadBtn.style.cssText = outlineBtn;
        var backupLoadInput = document.createElement('input');
        backupLoadInput.type = 'file';
        backupLoadInput.accept = '.json';
        backupLoadInput.style.cssText = 'display:none;';
        backupLoadInput.addEventListener('change', function () {
            if (backupLoadInput.files.length > 0) {
                loadAllCache(backupLoadInput.files[0], function (err, res) {
                    if (err) {
                        showToast('Failed to load cache file: ' + err.message, 'error');
                    } else {
                        showToast('Cache loaded: ' + res.summary + (res.failed.length ? ' (failed: ' + res.failed.join(', ') + ')' : ''), res.failed.length ? 'warn' : 'success');
                        var ci = document.getElementById(SCRIPT_ID + '-cache-info');
                        if (ci) ci.textContent = 'Cache: ' + Object.keys(getCCCache()).length + ' orders (just loaded)';
                    }
                    backupLoadInput.value = '';
                });
            }
        });
        backupLoadBtn.addEventListener('click', function () { backupLoadInput.click(); });

        // Grouped layout: one labelled row per purpose.
        function makeToolRow(label, nodes) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
            var lab = document.createElement('div');
            lab.textContent = label;
            lab.style.cssText = 'width:64px;flex:none;font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;';
            row.appendChild(lab);
            nodes.forEach(function (n) { row.appendChild(n); });
            return row;
        }
        cacheHeader.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:8px;';
        cacheHeader.appendChild(makeToolRow('Refresh', [precacheBtn, refreshCcBtn, refreshBtn]));
        cacheHeader.appendChild(makeToolRow('Backup', [backupDlBtn, backupLoadBtn, backupLoadInput]));

        var cacheInfo = document.createElement('div');
        cacheInfo.id = SCRIPT_ID + '-cache-info';
        cacheInfo.style.cssText = 'font-size:11px;color:#888;';
        try {
            var age = GM_getValue(CC_CACHE_AGE_KEY, 0);
            var progress = getCCProgress();
            if (progress && progress.done < progress.total) {
                cacheInfo.textContent = 'Cache build in progress: ' + progress.done + '/' + progress.total + ' (resume on next run)';
            } else if (age) {
                var days = Math.floor((Date.now() - age) / 86400000);
                var cacheRaw = GM_getValue(CC_CACHE_KEY, null);
                var count = cacheRaw ? Object.keys(JSON.parse(cacheRaw)).length : 0;
                cacheInfo.textContent = 'Cache: ' + count + ' orders, ' + days + 'd old';
            } else {
                cacheInfo.textContent = 'Cache: empty (will build on first run)';
            }
        } catch (e) {
            cacheInfo.textContent = 'Cache: empty';
        }

        cacheBody.appendChild(cacheHeader);
        cacheBody.appendChild(cacheInfo);
        cacheSection.appendChild(cacheBody);

        // ── Report Buttons ──
        // Left/right column assignment (explicit, not grid auto-flow) so a
        // shorter group like Purchase Orders doesn't leave dead space next to
        // it — Tools stacks directly under Inventory on the right instead.
        var REPORT_COLUMNS = {
            left: ['Orders', 'Purchase Orders', 'Tools'],
            right: ['Library', 'Inventory']
        };

        var reportGrid = document.createElement('div');
        reportGrid.className = 'report-grid';

        var leftCol = document.createElement('div');
        leftCol.className = 'report-col';
        var rightCol = document.createElement('div');
        rightCol.className = 'report-col';

        var groups = {};
        Object.keys(REPORTS).forEach(function (key) {
            var r = REPORTS[key];
            if (!groups[r.group]) groups[r.group] = [];
            groups[r.group].push({ key: key, label: r.label, wired: r.wired });
        });

        var groupOrder = REPORT_COLUMNS.left.concat(REPORT_COLUMNS.right)
            .filter(function (g) { return groups[g]; });
        // Any group not explicitly placed still renders (falls into the left column).
        Object.keys(groups).forEach(function (g) {
            if (groupOrder.indexOf(g) === -1) groupOrder.push(g);
        });

        groupOrder.forEach(function (groupName) {
            var groupDiv = document.createElement('div');
            groupDiv.className = 'report-group';

            var h4 = document.createElement('h4');
            h4.style.cssText = 'display:flex;align-items:center;gap:6px;margin:0 0 8px;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;';
            var titleSpan = document.createElement('span');
            titleSpan.textContent = groupName;
            h4.appendChild(titleSpan);

            // Add "* uses date range" note for groups that have date-filtered reports
            if (groupName === 'Orders' || groupName === 'Purchase Orders') {
                var note = document.createElement('span');
                note.textContent = '* uses date range';
                note.style.cssText = 'font-size:10px;color:#999;font-weight:400;text-transform:none;letter-spacing:0;';
                h4.appendChild(note);
            }

            groupDiv.appendChild(h4);

            groups[groupName].forEach(function (r) {
                var btn = document.createElement('button');
                btn.className = 'report-btn' + (r.wired ? ' wired' : '');

                var labelSpan = document.createTextNode(r.label + ' ');
                btn.appendChild(labelSpan);

                if (!r.wired) {
                    var tag = document.createElement('span');
                    tag.className = 'tag tag-wip';
                    tag.textContent = 'WIP';
                    btn.appendChild(tag);
                }

                // Add note for Subcontracts button
                if (r.key === 'subcontract') {
                    var note = document.createElement('span');
                    note.textContent = ' (includes all staff)';
                    note.style.cssText = 'font-size:10px;color:#999;font-weight:400;';
                    btn.appendChild(note);
                }

                btn.addEventListener('click', function () {
                    // Capture filters BEFORE the modal is removed — dispatched runs
                    // (same-page or cross-page) rely on getDateRange()/getSelectedCategories()/getSelectedOffices()
                    // falling back to this snapshot.
                    var clickedDates = getDateRange();
                    var clickedCats = getSelectedCategories();
                    var clickedOffices = getSelectedOffices();
                    var clickedControlled = getControlledGoods();
                    var clickedSelectedRep = getSelectedRep();
                    var clickedExcludeFrontEnd = getExcludeFrontEnd();
                    var clickedFrontEndReps = getFrontEndRepsSnapshot();
                    pendingFilters = {
                        dates: { start: clickedDates.start, end: clickedDates.end },
                        cats: clickedCats,
                        offices: clickedOffices,
                        controlledGoods: clickedControlled,
                        selectedRep: clickedSelectedRep,
                        excludeFrontEnd: clickedExcludeFrontEnd,
                        frontEndReps: clickedFrontEndReps
                    };
                    var manualInput = document.getElementById(SCRIPT_ID + '-manual-filter-input');
                    var manualRangeCb = document.getElementById(SCRIPT_ID + '-manual-filter-range');
                    pendingFilters.manualNumber = (manualInput && manualInput.value != null) ? String(manualInput.value).trim() : '';
                    pendingFilters.manualApplyRange = !!(manualRangeCb && manualRangeCb.checked);
                    var inhouseCb = document.getElementById(SCRIPT_ID + '-' + r.key + '-range');
                    pendingFilters[r.key + 'ApplyRange'] = !!(inhouseCb && inhouseCb.checked);
                    closeModal();
                    console.log('[AUDIT] Button clicked, dispatching:', r.key);
                    dispatchReport(r.key);
                });

                if (r.key === 'manualUsage') {
                    // Manual Usage gets its own search box + "use date range"
                    // toggle, inline with the button: fill a manual number to
                    // list every unit that used it, ignoring the date range
                    // unless the checkbox is checked.
                    btn.style.cssText = 'flex:0 0 auto;width:auto;min-width:120px;padding-left:10px;padding-right:10px;margin-bottom:0;';

                    var manualRow = document.createElement('div');
                    manualRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;';

                    var mLabel = document.createElement('span');
                    mLabel.textContent = 'Man#';
                    mLabel.style.cssText = 'font-size:11px;color:#666;text-transform:uppercase;font-weight:600;flex:0 0 auto;';

                    var mInput = document.createElement('input');
                    mInput.id = SCRIPT_ID + '-manual-filter-input';
                    mInput.type = 'text';
                    mInput.placeholder = 'e.g. 3514';
                    mInput.style.cssText = 'flex:0 0 80px;width:80px;padding:4px 6px;border:1px solid #ccc;border-radius:3px;font-size:12px;box-sizing:border-box;';
                    mInput.title = 'Manual number to look up. Fill it to list every unit that used that manual (ignores the date range unless "Use date range" is checked).';

                    var cbLabel = document.createElement('label');
                    cbLabel.style.cssText = 'font-size:11px;color:#555;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;flex:0 0 auto;';
                    var mCb = document.createElement('input');
                    mCb.id = SCRIPT_ID + '-manual-filter-range';
                    mCb.type = 'checkbox';
                    mCb.title = 'Apply the date range above. Leave unchecked to ignore it (manual # and blank searches both respect this).';
                    cbLabel.appendChild(mCb);
                    cbLabel.appendChild(document.createTextNode('Use date range'));

                    manualRow.appendChild(btn);
                    manualRow.appendChild(mLabel);
                    manualRow.appendChild(mInput);
                    manualRow.appendChild(cbLabel);

                    groupDiv.appendChild(manualRow);
                } else if (r.key === 'manualInhouse' || r.key === 'gidep') {
                    // Manual Inhouse / GIDEP: same date range the Usage search
                    // uses, gated by a "Use date range" checkbox inline with the
                    // button (scan all WOs when off). No manual-number text box —
                    // the report tallies every order's selected manual.
                    btn.style.cssText = 'flex:1 1 auto;width:auto;min-width:110px;margin-bottom:0;';

                    var ihRow = document.createElement('div');
                    ihRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;';

                    var ihCbLabel = document.createElement('label');
                    ihCbLabel.style.cssText = 'font-size:11px;color:#555;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;flex:0 0 auto;';
                    var ihCb = document.createElement('input');
                    ihCb.id = SCRIPT_ID + '-' + r.key + '-range';
                    ihCb.type = 'checkbox';
                    ihCb.title = (r.applyDateRangeHelp) || 'Apply the date range above. Leave unchecked to scan ALL YEG/BRI work orders.';
                    ihCbLabel.appendChild(ihCb);
                    ihCbLabel.appendChild(document.createTextNode('Use date range'));

                    ihRow.appendChild(btn);
                    ihRow.appendChild(ihCbLabel);
                    groupDiv.appendChild(ihRow);
                } else {
                    groupDiv.appendChild(btn);
                }
            });

            var targetCol = REPORT_COLUMNS.right.indexOf(groupName) !== -1 ? rightCol : leftCol;
            targetCol.appendChild(groupDiv);
        });

        reportGrid.appendChild(leftCol);
        reportGrid.appendChild(rightCol);
        box.appendChild(reportGrid);

        // Cache section (collapsible) sits after the report buttons.
        box.appendChild(cacheSection);

        // ── WO Reconciliation (legacy CSV vs live app) ──
        // Folded into the collapsible Cache Tools; separated by a top border.
        var reconHeader = document.createElement('div');
        reconHeader.style.cssText = 'border-top:1px solid #e0e0e0;margin-top:10px;padding-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
        reconHeader.innerHTML = '<span style="font-weight:700;font-size:12px;color:#c0392b;text-transform:uppercase;">WO Reconciliation</span>'
            + '<span style="font-size:11px;color:#888;">Upload a legacy CSV export to cross-reference against the live app (matched on WO#).</span>';

        var reconBtn = document.createElement('button');
        reconBtn.textContent = 'Upload CSV & Reconcile';
        reconBtn.style.cssText = 'background:#c0392b;color:#fff;border:none;border-radius:3px;padding:5px 12px;font-size:12px;cursor:pointer;';
        var reconInput = document.createElement('input');
        reconInput.type = 'file';
        reconInput.accept = '.csv,.txt,*';
        reconInput.style.cssText = 'display:none;';
        reconInput.addEventListener('change', function () {
            if (reconInput.files.length === 0) return;
            var file = reconInput.files[0];
            var reader = new FileReader();
            reader.onload = function (e) {
                showProgress('Reconciling ' + file.name + '…');
                runWoReconciliation(String(e.target.result), function (msg) {
                    showProgress(msg);
                }).then(function (result) {
                    hideProgress();
                    showToast('Reconciliation complete: ' + result.counts.matched + ' matched, ' + result.counts.missing + ' missing', result.counts.missing ? 'warn' : 'ok');
                    presentWoReconciliation(result);
                }).catch(function (err) {
                    hideProgress();
                    showToast('Reconciliation failed: ' + err.message, 'warn');
                });
            };
            reader.readAsText(file);
            reconInput.value = '';
        });
        reconBtn.addEventListener('click', function () { reconInput.click(); });

        reconHeader.appendChild(reconBtn);
        reconHeader.appendChild(reconInput);
        cacheBody.appendChild(reconHeader);

        // ── Actions ──
        var actions = document.createElement('div');
        actions.className = 'audit-actions';

        box.appendChild(actions);
        overlay.appendChild(box);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
        document.body.appendChild(overlay);

        // ── Sync modal dates from page's #startDate / #endDate ──
        try {
            var appStart = document.getElementById('startDate');
            var appEnd = document.getElementById('endDate');
            var appSD = $p && appStart ? $p(appStart).data('kendoDatePicker') : null;
            var appED = $p && appEnd ? $p(appEnd).data('kendoDatePicker') : null;

            var defaultStart = appSD && appSD.value() ? appSD.value() : new Date(Date.now() - 30 * 86400000);
            var defaultEnd = appED && appED.value() ? appED.value() : new Date();

            var sEl = document.getElementById(SCRIPT_ID + '-date-start');
            var eEl = document.getElementById(SCRIPT_ID + '-date-end');

            // Attach Kendo date pickers (calendar buttons, dd-MMM-yyyy display).
            // Kendo needs the element in the DOM to measure/position popups, so
            // this runs after the modal is appended above.
            var sOk = initModalDatePicker(sEl, defaultStart);
            var eOk = initModalDatePicker(eEl, defaultEnd);

            if (!sOk && sEl) sEl.value = toDisplayDate(defaultStart);
            if (!eOk && eEl) eEl.value = toDisplayDate(defaultEnd);
        } catch (e) {}
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  DIAGNOSTIC: field-history ship-date test on ONE order
    //  Run from the browser console:   auditHistTest('OC-YEG-305692')
    //  Validates the "Edit-page field Id + Bristow Status history" recovery on a
    //  single known backlog order before letting the report scan the whole set.
    // ═════════════════════════════════════════════════════════════════════════

    // Fetches the _StatusHistory HTML for a field Id and returns { html, date }.
    function fetchStatusHistoryRawTest(fieldId) {
        return new Promise(function (resolve) {
            if (!fieldId) return resolve({ html: '', date: null });
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', '/Orders/Shared/_StatusHistory?Id=' + encodeURIComponent(fieldId) + '&_=' + Date.now(), true);
                xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
                xhr.timeout = 60000;
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4) return;
                    if (xhr.status !== 200) return resolve({ html: '', date: null, status: xhr.status });
                    resolve({ html: xhr.responseText, date: parseStatusHistoryShipDate(xhr.responseText) });
                };
                xhr.onerror = function () { resolve({ html: '', date: null, error: 'network' }); };
                xhr.ontimeout = function () { resolve({ html: '', date: null, error: 'timeout' }); };
                xhr.send();
            } catch (e) { resolve({ html: '', date: null, error: 'exception' }); }
        });
    }

    function auditHistTest(orderNo) {
        clearHistCache();
        return bulkFetchOrderRepMap().then(function (woMap) {
            var w = woMap[orderNo];
            if (!w || !w.id) {
                console.warn('[AUDIT-HIST] order not found in completed grid: ' + orderNo);
                showToast('Order not found: ' + orderNo, 'warn');
                return { ok: false, reason: 'not-found' };
            }
            console.log('[AUDIT-HIST] order', orderNo, '| Edit id =', w.id, '| grid bsFieldId =', JSON.stringify(w.bsFieldId), '| createdAt =', String(w.createdAt || ''));
            return fetchBsFieldIdFromEdit(w.id).then(function (r) {
                var fieldId = (r && r.id) || '';
                console.log('[AUDIT-HIST] field Id from Edit page =', JSON.stringify(fieldId), '| status =', r && r.status);
                var useField = fieldId || w.bsFieldId || '';
                return fetchStatusHistoryRawTest(useField).then(function (r2) {
                    var ds = (r2 && r2.date && !isNaN(r2.date.getTime())) ? toDisplayDate(r2.date) : null;
                    console.log('[AUDIT-HIST] shippedDate =', JSON.stringify(ds), '| raw Date =', r2 && r2.date);
                    if (!ds && r2 && r2.html) {
                        console.log('[AUDIT-HIST] history HTML size =', r2.html.length, '| snippet:\n' + r2.html.slice(0, 1200));
                    }
                    showToast('Order ' + orderNo + (ds ? ' shipped ' + ds : ' — no Shipped date found'), ds ? 'info' : 'warn');
                    return { ok: !!ds, orderNo: orderNo, fieldId: useField, shippedDateString: ds, status: (r && r.status) || (r2 && r2.status), error: r2 && r2.error };
                });
            });
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  INIT
    // ═════════════════════════════════════════════════════════════════════════

    function init() {
        injectStyles();
        applyAuditorMode();
        injectButton();
        checkDispatch();
        if (TS) TS.log('AUDIT Console v4.38 loaded');
        else console.log('[AUDIT] Console v4.16 loaded');
        try { if (window.unsafeWindow) window.unsafeWindow.auditHistTest = auditHistTest; } catch (e) {}
        try { window.auditHistTest = auditHistTest; } catch (e) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();