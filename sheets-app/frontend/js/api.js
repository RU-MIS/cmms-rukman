// API client for the Apps Script web app.
//
// - POST with a text/plain body and no custom headers: a CORS "simple request",
//   because Apps Script cannot answer a CORS preflight (OPTIONS).
// - Apps Script answers with a redirect to script.googleusercontent.com; fetch
//   follows it. No cookies are sent (credentials: 'omit').
// - The session token lives in sessionStorage only (cleared when the tab closes),
//   never in localStorage or cookies. It is not a privileged credential: the
//   server stores only its hash and re-checks the user, role and expiry on every call.
(function () {
  'use strict';

  var KEY = 'rdms.session';

  var Session = {
    get: function () {
      try { return JSON.parse(window.sessionStorage.getItem(KEY)); } catch (e) { return null; }
    },
    set: function (s) {
      window.sessionStorage.setItem(KEY, JSON.stringify({ token: s.token, user: s.user, permissions: s.permissions,
        mustChangePassword: !!s.mustChangePassword, expiresAt: s.expiresAt }));
    },
    update: function (patch) {
      var s = Session.get();
      if (!s) return;
      Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
      window.sessionStorage.setItem(KEY, JSON.stringify(s));
    },
    clear: function () { window.sessionStorage.removeItem(KEY); }
  };

  function ApiError(code, message) {
    this.name = 'ApiError';
    this.code = code;
    this.message = message;
  }
  ApiError.prototype = Object.create(Error.prototype);

  var SIGNED_OUT = ['UNAUTHENTICATED', 'SESSION_EXPIRED'];

  function call(action, data) {
    var cfg = window.RDMS_CONFIG || {};
    var url = cfg.apiUrl || '';
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url) && !cfg.allowTestUrl) {
      return Promise.reject(new ApiError('CONFIG', 'The application is not configured yet (js/config.js → apiUrl).'));
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return Promise.reject(new ApiError('OFFLINE', 'No internet connection. Check the connection and try again.'));
    }
    var s = Session.get();
    var body = JSON.stringify({
      action: action,
      token: s && s.token ? s.token : undefined,
      data: data || {},
      client: { userAgent: String(navigator.userAgent || '').slice(0, 200) }
    });
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, cfg.requestTimeoutMs || 30000) : null;

    return fetch(url, {
      method: 'POST',
      body: body,                 // string body → Content-Type: text/plain;charset=UTF-8
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller ? controller.signal : undefined
    }).catch(function (e) {
      if (e && e.name === 'AbortError') throw new ApiError('TIMEOUT', 'The server did not answer in time. Please try again.');
      throw new ApiError('NETWORK', 'Could not reach the server. Check the internet connection and try again.');
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new ApiError('HTTP', 'The server answered with an error (HTTP ' + res.status + ').');
      return res.text();
    }).then(function (text) {
      var json;
      try { json = JSON.parse(text); } catch (e) {
        throw new ApiError('BAD_RESPONSE', 'Unexpected answer from the server. (Is the Apps Script web app deployed with access "Anyone"?)');
      }
      if (!json || typeof json.ok !== 'boolean') throw new ApiError('BAD_RESPONSE', 'Unexpected answer from the server.');
      if (!json.ok) {
        var err = new ApiError(json.error && json.error.code || 'ERROR', json.error && json.error.message || 'Request failed');
        if (SIGNED_OUT.indexOf(err.code) >= 0 && action !== 'login') {
          Session.clear();
          window.dispatchEvent(new CustomEvent('rdms:signed-out', { detail: { message: err.message } }));
        }
        throw err;
      }
      return json.data;
    });
  }

  /** Show / hide buttons for password fields: <button class="pw-toggle" data-target="inputId">. */
  function wirePasswordToggles(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('.pw-toggle'), function (btn) {
      var input = document.getElementById(btn.getAttribute('data-target'));
      if (!input || btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.setAttribute('aria-label', 'Show password');
      btn.addEventListener('click', function () {
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Hide' : 'Show';
        btn.setAttribute('aria-pressed', show ? 'true' : 'false');
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
    });
  }

  window.RDMS = { call: call, Session: Session, ApiError: ApiError, wirePasswordToggles: wirePasswordToggles };
})();
