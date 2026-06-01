// ==UserScript==
// @name         TECH - Parts Preloader
// @namespace    http://tampermonkey.net/
// @version      4.0
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Parts-Preloader.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Parts-Preloader.user.js
// @description  Caches full parts dataset in IndexedDB — instant load after first fetch
// @match        https://bristow-app.azurewebsites.net/Orders/Orders/Edit*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    var DB_NAME    = 'BristowPartsCache';
    var DB_VERSION = 1;
    var STORE_NAME = 'parts';
    var CACHE_KEY  = 'allParts';
    var MAX_AGE_MS = 24 * 60 * 60 * 1000; // refresh cache once per day

    var _indicator   = null;
    var _currentGrid = null;

    function showStatus(msg, color) {
        if (!_indicator) {
            _indicator = document.createElement('div');
            _indicator.id = 'parts-cache-indicator';
            _indicator.style.cssText = [
                'position:fixed', 'bottom:70px', 'left:16px', 'z-index:99999',
                'background:#333', 'color:#fff', 'font-size:12px',
                'font-family:system-ui,sans-serif', 'padding:5px 10px',
                'border-radius:6px', 'opacity:0.85', 'pointer-events:none',
                'transition:opacity 0.4s'
            ].join(';');
            document.body.appendChild(_indicator);
        }
        _indicator.style.background = color || '#333';
        _indicator.style.opacity    = '0.85';
        _indicator.textContent      = msg;
    }

    function hideStatus(delay) {
        setTimeout(function () {
            if (_indicator) _indicator.style.opacity = '0';
        }, delay || 2000);
    }

    // =========================================================================
    // SILENT FETCH: fetch fresh parts via fetch() — never touches Kendo transport
    // =========================================================================

    function silentFetchAndCache(onDone) {
        var url = '../../../Catalog/Parts/PartList/Index?handler=Parts';
        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var records = data && data.Data ? data.Data : (Array.isArray(data) ? data : null);
                if (!records || records.length === 0) {
                    console.warn('[PartsCache] Silent fetch returned no records.');
                    onDone && onDone(false);
                    return;
                }
                var payload = { timestamp: Date.now(), records: records };
                dbSet(CACHE_KEY, payload, function () {
                    if (_currentGrid) {
                        _currentGrid.dataSource.transport.read = function (options) {
                            options.success(records);
                        };
                        _currentGrid.dataSource.read();
                    }
                    console.log('[PartsCache] Silent fetch saved ' + records.length + ' parts.');
                    onDone && onDone(true);
                });
            })
            .catch(function (e) {
                console.warn('[PartsCache] Silent fetch failed:', e);
                onDone && onDone(false);
            });
    }

    // =========================================================================
    // INDEXEDDB HELPERS
    // =========================================================================

    function openDB(callback) {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
            e.target.result.createObjectStore(STORE_NAME);
        };
        req.onsuccess = function (e) { callback(null, e.target.result); };
        req.onerror   = function (e) { callback(e.target.error, null); };
    }

    function dbGet(key, callback) {
        openDB(function (err, db) {
            if (err) return callback(err, null);
            var tx  = db.transaction(STORE_NAME, 'readonly');
            var req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = function (e) { callback(null, e.target.result); };
            req.onerror   = function (e) { callback(e.target.error, null); };
        });
    }

    function dbSet(key, value, callback) {
        openDB(function (err, db) {
            if (err) return callback && callback(err);
            var tx  = db.transaction(STORE_NAME, 'readwrite');
            var req = tx.objectStore(STORE_NAME).put(value, key);
            req.onsuccess = function () { callback && callback(null); };
            req.onerror   = function (e) { callback && callback(e.target.error); };
        });
    }

    // =========================================================================
    // WAIT FOR KENDO GRID
    // =========================================================================

    function waitForGrid(callback) {
        var tries    = 0;
        var maxTries = 60;
        var tid = setInterval(function () {
            tries++;
            try {
                var grid = window.$ && $('#partGrid').data('kendoGrid');
                if (grid && grid.dataSource) {
                    clearInterval(tid);
                    callback(grid);
                    return;
                }
            } catch (e) {}
            if (tries >= maxTries) {
                clearInterval(tid);
                console.warn('[PartsCache] Grid never appeared.');
            }
        }, 200);
    }

    // =========================================================================
    // INTERCEPT: save data after Kendo fetches it from server
    // =========================================================================

    function interceptAndCache(grid) {
        grid.dataSource.bind('change', function () {
            var data = grid.dataSource.data();
            if (!data || data.length === 0) return;
            var plain = [];
            for (var i = 0; i < data.length; i++) {
                plain.push(data[i].toJSON ? data[i].toJSON() : data[i]);
            }
            dbSet(CACHE_KEY, { timestamp: Date.now(), records: plain }, function (err) {
                if (err) console.warn('[PartsCache] Save failed:', err);
                else console.log('[PartsCache] Saved ' + plain.length + ' parts to IndexedDB.');
            });
        });
    }

    // =========================================================================
    // INJECT: load cached data into grid, skip server fetch
    // =========================================================================

    function injectFromCache(grid, records) {
        try {
            grid.dataSource.transport.read = function (options) {
                options.success(records);
            };
            grid.dataSource.read();
            console.log('[PartsCache] Injected ' + records.length + ' parts from cache.');
        } catch (e) {
            console.warn('[PartsCache] Inject failed, falling back to server fetch:', e);
            grid.dataSource.read();
        }
    }

    // =========================================================================
    // MAIN
    // =========================================================================

    window.addEventListener('load', function () {
        waitForGrid(function (grid) {
            _currentGrid = grid;

            dbGet(CACHE_KEY, function (err, cached) {
                var now     = Date.now();
                var isStale = !cached || (now - cached.timestamp) > MAX_AGE_MS;
                var isEmpty = !cached || !cached.records || cached.records.length === 0;

                if (isEmpty) {
                    showStatus('⏳ Loading parts (first time)...', '#555');
                    interceptAndCache(grid);
                    grid.dataSource.read();
                    grid.dataSource.bind('change', function () {
                        if (grid.dataSource.data().length > 0) {
                            showStatus('✔ Parts loaded & cached', '#27ae60');
                            hideStatus(2500);
                        }
                    });
                } else if (isStale) {
                    showStatus('⚡ Parts loaded from cache', '#27ae60');
                    injectFromCache(grid, cached.records);
                    hideStatus(1500);
                    // Background refresh via fetch — never touches Kendo transport
                    setTimeout(function () {
                        silentFetchAndCache(function (success) {
                            console.log('[PartsCache] Background refresh ' + (success ? 'succeeded' : 'failed'));
                        });
                    }, 5000);
                } else {
                    showStatus('⚡ Parts loaded from cache', '#27ae60');
                    injectFromCache(grid, cached.records);
                    hideStatus(1500);
                }
            });
        });
    });

})();
