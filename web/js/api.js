// Fetch wrapper (architecture review, Phase 1): errors SURFACE.
//
// The old pattern — fetch().then(json).catch(function(){}) — swallowed a
// ReferenceError and silently deleted the admin review queue for a day.
// api() rejects loudly on network failure and non-2xx, and every rejection
// is at least logged, so "the section just isn't there" can never again be
// the only symptom.
(function (root) {
  'use strict';

  function api(path, opts) {
    return fetch(path, opts).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          var err = new Error(body.error || (path + ' -> HTTP ' + r.status));
          err.status = r.status;
          err.body = body;
          throw err;
        });
      }
      return r.json();
    });
  }
  api.post = function (path, body) {
    return api(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  };
  // for fire-and-forget calls: failure is logged, never invisible
  api.logged = function (p, what) {
    return p.catch(function (e) {
      console.error((what || 'api call') + ' failed:', e);
      throw e;
    });
  };

  root.api = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
