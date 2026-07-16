// ==UserScript==
// @name         TECH - Shared Core
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Shared utilities for all TECH scripts — observer manager, polling, DOM helpers, iframe access
// @match        https://bristow-app.azurewebsites.net/*
// @updateURL    https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Shared-Core.user.js
// @downloadURL  https://raw.githubusercontent.com/Bristow-Scripts/bristow-scripts/main/TECH---Shared-Core.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ═════════════════════════════════════════════════════════════════════════
    //  CORE OBJECT
    // ═════════════════════════════════════════════════════════════════════════

    var TS = {
        version: '1.1',
        ready: false,
        _isPaused: false,
    };

    // ═════════════════════════════════════════════════════════════════════════
    //  LOGGING
    // ═════════════════════════════════════════════════════════════════════════

    TS.log = function (msg, level) {
        var prefix = '[TechShared]';
        if (level === 'warn') console.warn(prefix + ' ' + msg);
        else if (level === 'error') console.error(prefix + ' ' + msg);
        else console.log(prefix + ' ' + msg);
    };

    // ═════════════════════════════════════════════════════════════════════════
    //  OBSERVER MANAGER — single MutationObserver, subscriber pattern
    // ═════════════════════════════════════════════════════════════════════════

    TS.observer = (function () {
        var _subscribers = {};
        var _nextId = 1;
        var _observer = null;
        var _pendingMutations = null;

        function _flush() {
            if (TS._isPaused) return;
            _pendingMutations = null;
            var keys = Object.keys(_subscribers);
            for (var i = 0; i < keys.length; i++) {
                var entry = _subscribers[keys[i]];
                if (!entry) continue;
                clearTimeout(entry._timer);
                entry._timer = setTimeout(entry.fn, entry.debounce);
            }
        }

        function _ensureObserver() {
            if (_observer) return;
            var target = document.body || document.documentElement;
            if (!target) return;
            _observer = new MutationObserver(function (mutations) {
                if (TS._isPaused) return;
                _pendingMutations = mutations;
                _flush();
            });
            _observer.observe(target, { childList: true, subtree: true });
        }

        return {
            register: function (fn, opts) {
                opts = opts || {};
                var id = 'obs_' + (_nextId++);
                _subscribers[id] = {
                    fn: fn,
                    debounce: opts.debounce || 150,
                    _timer: null,
                };
                _ensureObserver();
                return id;
            },
            unregister: function (id) {
                if (_subscribers[id]) {
                    clearTimeout(_subscribers[id]._timer);
                    delete _subscribers[id];
                }
            },
            pause: function () {
                TS._isPaused = true;
            },
            resume: function () {
                TS._isPaused = false;
                if (_pendingMutations) _flush();
            },
        };
    })();

    // ═════════════════════════════════════════════════════════════════════════
    //  POLLING MANAGER — single setInterval, iterates active polls
    // ═════════════════════════════════════════════════════════════════════════

    TS.poll = (function () {
        var _active = {};
        var _intervalMs = 200;
        var _timer = null;
        var _nextId = 1;

        function _tick() {
            var keys = Object.keys(_active);
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                var p = _active[key];
                if (!p) continue;
                try {
                    var result = p.fn();
                    if (result) {
                        p.cb(result);
                        delete _active[key];
                        continue;
                    }
                } catch (e) {
                    TS.log('Poll error (' + p.label + '): ' + e.message, 'warn');
                    delete _active[key];
                    continue;
                }
                p.elapsed += _intervalMs;
                if (p.elapsed >= p.timeout) {
                    TS.log('Timed out: ' + p.label, 'warn');
                    delete _active[key];
                }
            }
            if (Object.keys(_active).length === 0 && _timer) {
                clearInterval(_timer);
                _timer = null;
            }
        }

        function _ensureTimer() {
            if (_timer) return;
            _timer = setInterval(_tick, _intervalMs);
        }

        return function (label, condFn, onFound, timeoutMs, intervalMs) {
            timeoutMs = timeoutMs || 15000;
            // NOTE: previously this used `label` directly as the _active key. Since
            // TS.iframe.waitForReady() (and other shared helpers) always poll under the
            // same hardcoded label, two concurrent callers with the same label would
            // silently overwrite each other here — the second caller's callback would
            // survive and the first's would be orphaned forever, no error. Give every
            // registration its own unique key (same pattern as TS.observer.register's
            // 'obs_' + id), and keep the caller's label only for logging.
            var key = label + '_' + (_nextId++);
            _active[key] = {
                label: label,
                fn: condFn,
                cb: onFound,
                timeout: timeoutMs,
                elapsed: 0,
            };
            _ensureTimer();
            return function () {
                delete _active[key];
            };
        };
    })();

    // ═════════════════════════════════════════════════════════════════════════
    //  DOM HELPERS
    // ═════════════════════════════════════════════════════════════════════════

    TS.dom = {
        query: function (sel, ctx) {
            return (ctx || document).querySelector(sel);
        },

        wait: function (elementId, timeoutMs) {
            timeoutMs = timeoutMs || 15000;
            return new Promise(function (resolve) {
                var el = document.getElementById(elementId);
                if (el) return resolve(el);
                var cancel = TS.poll(elementId, function () {
                    return document.getElementById(elementId);
                }, function (el) {
                    resolve(el);
                }, timeoutMs);
            });
        },

        getJobLink: function () {
            var link = document.querySelector("a.monospaced[href*='Orders/Jobs/Edit']");
            return link ? link.href : null;
        },

        getJobId: function () {
            var link = document.querySelector("a.monospaced[href*='Orders/Jobs/Edit']");
            if (link) {
                try { return new URL(link.href).searchParams.get('id'); } catch (e) {}
            }
            var f = TS.iframe.getVisible();
            if (f) {
                try { return new URL(f.src).searchParams.get('id'); } catch (e) {}
            }
            return null;
        },

        getOrderId: function () {
            return new URLSearchParams(window.location.search).get('id');
        },

        getOrderRepName: function () {
            var rows = document.querySelectorAll('table.lq-table-info th');
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].textContent.trim() === 'Order Rep') {
                    var td = rows[i].nextElementSibling;
                    if (td) {
                        var span = td.querySelector('span');
                        if (span && span.textContent.trim()) return span.textContent.trim();
                    }
                }
            }
            return 'Unknown Tech';
        },

        isOrderComplete: function () {
            var rows = document.querySelectorAll('table.lq-table-info th');
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].textContent.trim() === 'Order Status') {
                    var td = rows[i].nextElementSibling;
                    if (td && td.textContent.trim() === 'Complete') return true;
                }
            }
            return false;
        },
    };

    // ═════════════════════════════════════════════════════════════════════════
    //  IFRAME ACCESS
    // ═════════════════════════════════════════════════════════════════════════

    TS.iframe = {
        getVisible: function () {
            return document.querySelector('#collapseTimeExpanded iframe');
        },

        getDoc: function () {
            var f = TS.iframe.getVisible();
            if (!f) return null;
            try { return f.contentDocument || f.contentWindow.document; } catch (e) { return null; }
        },

        getWin: function () {
            var f = TS.iframe.getVisible();
            if (!f) return null;
            try { return f.contentWindow; } catch (e) { return null; }
        },

        getCsrf: function () {
            var iDoc = TS.iframe.getDoc();
            if (!iDoc) return null;
            var t = iDoc.querySelector('input[name="__RequestVerificationToken"]');
            return t ? t.value : null;
        },

        waitForReady: function (callback, timeoutMs) {
            timeoutMs = timeoutMs || 60000;
            TS.poll('iframe ready', function () {
                var iDoc = TS.iframe.getDoc();
                return (iDoc && iDoc.querySelector('.k-input-value-text')) ? true : null;
            }, callback, timeoutMs);
        },
    };

    // ═════════════════════════════════════════════════════════════════════════
    //  KENDO HELPERS
    // ═════════════════════════════════════════════════════════════════════════

    TS.kendo = {
        getGrid: function (elementId) {
            try {
                return window.$ && $('#' + elementId).data('kendoGrid');
            } catch (e) { return null; }
        },

        waitForGrid: function (elementId, callback, timeoutMs) {
            timeoutMs = timeoutMs || 12000;
            TS.poll('grid:' + elementId, function () {
                try {
                    var grid = window.$ && $('#' + elementId).data('kendoGrid');
                    return (grid && grid.dataSource) ? grid : null;
                } catch (e) { return null; }
            }, callback, timeoutMs);
        },
    };

    // ═════════════════════════════════════════════════════════════════════════
    //  CSRF TOKEN
    // ═════════════════════════════════════════════════════════════════════════

    TS.csrf = {
        get: function () {
            var el = document.querySelector('input[name="__RequestVerificationToken"]')
                   || document.querySelector('meta[name="RequestVerificationToken"]');
            return el ? (el.value || el.getAttribute('content')) : null;
        },
        getFromIframe: function () {
            return TS.iframe.getCsrf();
        },
    };

    // ═════════════════════════════════════════════════════════════════════════
    //  STORAGE WRAPPER
    // ═════════════════════════════════════════════════════════════════════════

    TS.storage = {
        get: function (key, defaultValue) {
            var val = localStorage.getItem(key);
            if (val === null) return defaultValue !== undefined ? defaultValue : null;
            return val;
        },
        set: function (key, val) {
            localStorage.setItem(key, val);
        },
        getObject: function (key) {
            try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
        },
        setObject: function (key, obj) {
            localStorage.setItem(key, JSON.stringify(obj));
        },
    };

    // ═════════════════════════════════════════════════════════════════════════
    //  TYPING DETECTION — pauses observer when user types in inputs
    // ═════════════════════════════════════════════════════════════════════════

    function _setupTypingDetection() {
        document.addEventListener('focusin', function (e) {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
                TS.observer.pause();
            }
        });
        document.addEventListener('focusout', function (e) {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
                TS.observer.resume();
            }
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  INIT
    // ═════════════════════════════════════════════════════════════════════════

    function _init() {
        if (TS.ready) return;
        TS.ready = true;
        _setupTypingDetection();
        TS.log('Shared Core v1.1 loaded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

    // Expose globally
    window.TechShared = TS;

})();
