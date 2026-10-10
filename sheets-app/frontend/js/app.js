// Application shell and Phase 1 screens. All data is rendered with textContent
// (never innerHTML), so values from the sheet cannot inject markup or scripts.
// Menu entries follow the permissions returned by the server; the server checks
// them again on every request, so hiding a button is never the security boundary.
(function () {
  'use strict';
  var R = window.RDMS;
  var view = document.getElementById('view');
  var navEl = document.getElementById('nav');
  var sidebar = document.getElementById('sidebar');
  var menuBtn = document.getElementById('menu-btn');
  var state = { me: null };

  // ------------------------------------------------------------ helpers
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { n.addEventListener(ev, attrs.on[ev]); });
      else if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function alertBox(kind, text) { return el('div', { 'class': 'alert ' + kind, role: kind === 'error' ? 'alert' : 'status', text: text }); }
  function can(p) { return !!(state.me && state.me.permissions.indexOf(p) >= 0); }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function busy(btn, on, label) { btn.disabled = on; if (label) btn.textContent = label; }
  function field(id, label, input, hint) {
    input.id = id;
    return el('div', {}, [el('label', { 'for': id, text: label }), input, hint ? el('div', { 'class': 'hint', text: hint }) : null]);
  }
  function passwordField(id, label, autocomplete) {
    var input = el('input', { type: 'password', autocomplete: autocomplete, maxlength: '128', required: true });
    input.id = id;
    var wrap = el('div', { 'class': 'pw' }, [input, el('button', { type: 'button', 'class': 'pw-toggle', 'data-target': id, 'aria-pressed': 'false', text: 'Show' })]);
    return el('div', {}, [el('label', { 'for': id, text: label }), wrap]);
  }
  function errorView(err) {
    clear(view);
    view.appendChild(alertBox('error', err && err.message ? err.message : 'Something went wrong.'));
  }

  function signOutTo(reason) {
    R.Session.clear();
    window.location.replace('index.html?reason=' + encodeURIComponent(reason));
  }
  window.addEventListener('rdms:signed-out', function () { signOutTo('expired'); });

  // ------------------------------------------------------------ navigation
  var ROUTES = [
    { path: '#/dashboard', label: 'Dashboard', perm: 'dashboard.view', render: renderDashboard },
    { path: '#/users', label: 'Users', perm: 'users.view', render: renderUsers },
    { path: '#/audit', label: 'Audit log', perm: 'audit.view', render: renderAudit },
    { path: '#/account', label: 'My account', perm: null, render: renderAccount }
  ];

  function buildNav() {
    clear(navEl);
    if (state.me.mustChangePassword) return;                         // only the password screen until it is changed
    ROUTES.forEach(function (r) {
      if (r.perm && !can(r.perm)) return;
      navEl.appendChild(el('a', { href: r.path, 'data-path': r.path, text: r.label }));
    });
  }

  function route() {
    var hash = window.location.hash || '#/dashboard';
    if (state.me.mustChangePassword) hash = '#/account';
    var r = ROUTES.filter(function (x) { return x.path === hash; })[0] || ROUTES[0];
    Array.prototype.forEach.call(navEl.querySelectorAll('a'), function (a) {
      if (a.getAttribute('data-path') === r.path) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    sidebar.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
    clear(view);
    view.appendChild(el('p', { 'class': 'loading', text: 'Loading…' }));
    r.render();
    view.focus({ preventScroll: true });
  }

  menuBtn.addEventListener('click', function () {
    var open = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') sidebar.classList.remove('open'); });
  document.getElementById('logout-btn').addEventListener('click', function () {
    R.call('logout').catch(function () { /* the session is cleared locally anyway */ }).then(function () { signOutTo('signed-out'); });
  });
  window.addEventListener('hashchange', route);

  // ------------------------------------------------------------ dashboard
  function renderDashboard() {
    R.call('dashboard').then(function (d) {
      clear(view);
      view.appendChild(el('h1', { text: 'Dashboard' }));
      view.appendChild(el('p', { 'class': 'muted', text: 'Welcome, ' + d.user.displayName + ' (' + d.user.role + '). Last sign-in: ' + fmtDate(d.user.lastLoginAt) }));
      if (d.users) {
        view.appendChild(el('div', { 'class': 'cards' }, [
          card('Active users', d.users.active), card('Admins', d.users.byRole.Admin), card('Managers', d.users.byRole.Manager),
          card('Staff', d.users.byRole.Staff), card('Disabled users', d.users.disabled), card('Locked accounts', d.users.locked)
        ]));
      }
      if (d.recentActivity) {
        var panel = el('section', { 'class': 'panel' }, [el('h2', { text: 'Recent activity' })]);
        panel.appendChild(d.recentActivity.length ? auditTable(d.recentActivity) : el('p', { 'class': 'empty', text: 'No activity yet.' }));
        view.appendChild(panel);
      }
      view.appendChild(el('section', { 'class': 'panel' }, [
        el('h2', { text: 'Business modules' }),
        el('p', { 'class': 'muted', text: 'Sales, purchases, stock, payments and accounts are added in Phase 2. No business figures are shown until those modules exist.' })
      ]));
    }).catch(errorView);
  }
  function card(label, value) {
    return el('div', { 'class': 'card' }, [el('div', { 'class': 'label', text: label }), el('div', { 'class': 'value', text: String(value) })]);
  }

  // ------------------------------------------------------------ users
  /** notice: optional { title, secret } shown after the list has been (re)loaded. */
  function renderUsers(notice) {
    R.call('listUsers').then(function (d) {
      clear(view);
      view.appendChild(el('h1', { text: 'Users' }));
      var msg = el('div', { id: 'users-msg' });
      view.appendChild(msg);
      if (notice && notice.secret) showSecret(msg, notice.title, notice.secret);
      if (can('users.manage')) view.appendChild(newUserForm(msg));
      var rows = d.users.map(function (u) {
        var tr = el('tr', { 'data-username': u.username }, [
          el('td', {}, [el('strong', { text: u.username }), el('div', { 'class': 'small muted', text: u.email || '' })]),
          el('td', { text: u.displayName }),
          el('td', { text: u.role }),
          el('td', {}, [el('span', { 'class': 'badge ' + (u.status === 'ACTIVE' ? 'ok' : 'off'), text: u.status }),
                        u.locked ? el('span', { 'class': 'badge off', text: 'LOCKED' }) : null,
                        u.mustChangePassword ? el('div', { 'class': 'small muted', text: 'temporary password' }) : null]),
          el('td', { text: fmtDate(u.lastLoginAt) }),
          el('td', {}, can('users.manage') ? userActions(u, msg) : [])
        ]);
        return tr;
      });
      var table = el('table', {}, [
        el('thead', {}, [el('tr', {}, ['Username', 'Name', 'Role', 'Status', 'Last sign-in', ''].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, rows)
      ]);
      view.appendChild(el('div', { 'class': 'table-wrap' }, [table]));
    }).catch(errorView);
  }

  function roleSelect(id, value) {
    var s = el('select', { id: id }, ['Admin', 'Manager', 'Staff'].map(function (r) { return el('option', { value: r, text: r }); }));
    s.value = value || 'Staff';
    return s;
  }

  function newUserForm(msg) {
    var form = el('form', { 'class': 'panel', id: 'new-user-form', novalidate: true }, [
      el('h2', { text: 'Add a user' }),
      el('div', { 'class': 'form-grid' }, [
        field('nu-username', 'Username', el('input', { autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', maxlength: '40' }), 'a–z, 0–9, dot, dash, underscore'),
        field('nu-name', 'Name', el('input', { maxlength: '80' })),
        field('nu-email', 'Email (optional)', el('input', { type: 'email', maxlength: '120' })),
        field('nu-role', 'Role', roleSelect('nu-role-select', 'Staff'))
      ]),
      el('div', { 'class': 'actions' }, [el('button', { type: 'submit', 'class': 'btn primary', id: 'nu-submit', text: 'Create user' })])
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('#nu-submit');
      busy(btn, true, 'Creating…');
      R.call('createUser', {
        username: form.querySelector('#nu-username').value, displayName: form.querySelector('#nu-name').value,
        email: form.querySelector('#nu-email').value, role: form.querySelector('#nu-role').value
      }).then(function (d) {
        renderUsers({ title: 'User ' + d.user.username + ' created.', secret: d.temporaryPassword });
      }).catch(function (err) {
        clear(msg); msg.appendChild(alertBox('error', err.message)); busy(btn, false, 'Create user');
      });
    });
    return form;
  }

  function showSecret(container, title, secret) {
    if (!container) return;
    clear(container);
    container.appendChild(el('div', { 'class': 'alert ok', role: 'status' }, [
      el('div', { text: title + ' Temporary password (shown once — give it to the user personally):' }),
      el('div', {}, [el('span', { 'class': 'secret', id: 'temp-password', text: secret })]),
      el('div', { 'class': 'small', text: 'The user must choose a new password at the first sign-in.' })
    ]));
  }

  function userActions(u, msg) {
    var self = state.me && state.me.user.userId === u.userId;
    var act = function (label, cls, handler) { return el('button', { type: 'button', 'class': 'btn small ' + (cls || ''), text: label, on: { click: handler } }); };
    var out = [act('Edit', '', function () { editUser(u, msg); })];
    if (!self) out.push(act('Reset password', 'danger', function () {
      if (!window.confirm('Reset the password of ' + u.username + '? All of their sessions will be signed out.')) return;
      R.call('resetPassword', { userId: u.userId }).then(function (d) { showSecret(msg, 'Password of ' + u.username + ' reset.', d.temporaryPassword); })
        .catch(function (err) { clear(msg); msg.appendChild(alertBox('error', err.message)); });
    }));
    if (u.locked) out.push(act('Unlock', '', function () {
      R.call('unlockUser', { userId: u.userId }).then(function () { renderUsers(); }).catch(function (err) { clear(msg); msg.appendChild(alertBox('error', err.message)); });
    }));
    return [el('div', { 'class': 'actions' }, out)];
  }

  function editUser(u, msg) {
    clear(msg);
    var form = el('form', { 'class': 'panel', id: 'edit-user-form', novalidate: true }, [
      el('h2', { text: 'Edit ' + u.username }),
      el('div', { 'class': 'form-grid' }, [
        field('eu-name', 'Name', el('input', { maxlength: '80', value: u.displayName })),
        field('eu-email', 'Email', el('input', { type: 'email', maxlength: '120', value: u.email || '' })),
        el('div', {}, [el('label', { 'for': 'eu-role', text: 'Role' }), roleSelect('eu-role', u.role)]),
        el('div', {}, [el('label', { 'for': 'eu-status', text: 'Status' }), (function () {
          var s = el('select', { id: 'eu-status' }, [el('option', { value: 'ACTIVE', text: 'Active' }), el('option', { value: 'DISABLED', text: 'Disabled' })]);
          s.value = u.status; return s;
        })()])
      ]),
      el('div', { 'class': 'actions' }, [
        el('button', { type: 'submit', 'class': 'btn primary', text: 'Save' }),
        el('button', { type: 'button', 'class': 'btn', text: 'Cancel', on: { click: function () { clear(msg); } } })
      ])
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type=submit]');
      busy(btn, true, 'Saving…');
      R.call('updateUser', { userId: u.userId, displayName: form.querySelector('#eu-name').value, email: form.querySelector('#eu-email').value,
                             role: form.querySelector('#eu-role').value, status: form.querySelector('#eu-status').value })
        .then(function () { renderUsers(); })
        .catch(function (err) { busy(btn, false, 'Save'); form.insertBefore(alertBox('error', err.message), form.firstChild.nextSibling); });
    });
    msg.appendChild(form);
    form.querySelector('#eu-name').focus();
  }

  // ------------------------------------------------------------ audit log
  function auditTable(entries) {
    return el('div', { 'class': 'table-wrap' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, ['When', 'User', 'Action', 'Target', 'Result'].map(function (h) { return el('th', { text: h }); }))]),
      el('tbody', {}, entries.map(function (a) {
        return el('tr', {}, [el('td', { text: fmtDate(a.at) }), el('td', { text: a.username || 'system' }), el('td', { text: a.action }),
                             el('td', { text: a.target }), el('td', { text: a.result })]);
      }))
    ])]);
  }

  function renderAudit(skip) {
    skip = typeof skip === 'number' ? skip : 0;
    R.call('listAudit', { limit: 50, skip: skip }).then(function (d) {
      clear(view);
      view.appendChild(el('h1', { text: 'Audit log' }));
      view.appendChild(el('p', { 'class': 'muted', text: d.total + ' entries, newest first.' }));
      view.appendChild(d.entries.length ? auditTable(d.entries) : el('p', { 'class': 'empty', text: 'No entries.' }));
      var nav = el('div', { 'class': 'actions' }, [
        skip > 0 ? el('button', { type: 'button', 'class': 'btn small', text: 'Newer', on: { click: function () { renderAudit(Math.max(0, skip - d.limit)); } } }) : null,
        skip + d.limit < d.total ? el('button', { type: 'button', 'class': 'btn small', text: 'Older', on: { click: function () { renderAudit(skip + d.limit); } } }) : null
      ]);
      view.appendChild(nav);
    }).catch(errorView);
  }

  // ------------------------------------------------------------ my account
  function renderAccount() {
    var me = state.me;
    clear(view);
    view.appendChild(el('h1', { text: 'My account' }));
    if (me.mustChangePassword) {
      view.appendChild(alertBox('info', 'You signed in with a temporary password. Choose your own password to continue.'));
    }
    view.appendChild(el('section', { 'class': 'panel' }, [
      el('p', {}, [el('strong', { text: me.user.displayName }), ' · ' + me.user.username + ' · ' + me.user.role])
    ]));
    var msg = el('div', {});
    var form = el('form', { 'class': 'panel', id: 'password-form', novalidate: true }, [
      el('h2', { text: 'Change password' }),
      passwordField('cp-current', me.mustChangePassword ? 'Temporary password' : 'Current password', 'current-password'),
      passwordField('cp-new', 'New password', 'new-password'),
      passwordField('cp-repeat', 'Repeat new password', 'new-password'),
      el('div', { 'class': 'hint', text: 'At least 10 characters, with letters and digits, not containing your username.' }),
      el('div', { 'class': 'actions' }, [el('button', { type: 'submit', 'class': 'btn primary', id: 'cp-submit', text: 'Change password' })])
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clear(msg);
      var cur = form.querySelector('#cp-current').value, next = form.querySelector('#cp-new').value, rep = form.querySelector('#cp-repeat').value;
      if (!cur || !next) { msg.appendChild(alertBox('error', 'Fill in all password fields.')); return; }
      if (next !== rep) { msg.appendChild(alertBox('error', 'The new passwords do not match.')); return; }
      var btn = form.querySelector('#cp-submit');
      busy(btn, true, 'Saving…');
      R.call('changePassword', { currentPassword: cur, newPassword: next }).then(function () {
        var wasForced = state.me.mustChangePassword;
        state.me.mustChangePassword = false;
        R.Session.update({ mustChangePassword: false });
        form.reset();
        busy(btn, false, 'Change password');
        msg.appendChild(alertBox('ok', 'Password changed. Other devices have been signed out.'));
        if (wasForced) { buildNav(); window.location.hash = '#/dashboard'; }
      }).catch(function (err) {
        busy(btn, false, 'Change password');
        msg.appendChild(alertBox('error', err.message));
      });
    });
    view.appendChild(msg);
    view.appendChild(form);
    R.wirePasswordToggles(form);
  }

  // ------------------------------------------------------------ start
  if (!R.Session.get()) { window.location.replace('index.html'); return; }
  R.call('me').then(function (me) {
    state.me = me;
    R.Session.update({ user: me.user, permissions: me.permissions, mustChangePassword: me.mustChangePassword });
    document.getElementById('who').textContent = me.user.displayName + ' · ' + me.user.role;
    buildNav();
    route();
  }).catch(function (err) {
    if (err.code === 'UNAUTHENTICATED' || err.code === 'SESSION_EXPIRED') return;   // handled by the signed-out event
    errorView(err);
  });
})();
