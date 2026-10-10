// Login page.
(function () {
  'use strict';
  var R = window.RDMS;
  var form = document.getElementById('login-form');
  var notice = document.getElementById('notice');
  var submit = document.getElementById('submit');

  function show(kind, text) {
    notice.className = 'alert ' + kind;
    notice.textContent = text;
    notice.hidden = false;
  }

  R.wirePasswordToggles(document);

  // already signed in in this tab → straight to the app
  if (R.Session.get()) { window.location.replace('app.html'); return; }

  var reason = new URLSearchParams(window.location.search).get('reason');
  if (reason === 'expired') show('info', 'Your session has ended. Please sign in again.');
  if (reason === 'signed-out') show('ok', 'You have been signed out.');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var username = document.getElementById('username').value.trim();
    var password = document.getElementById('password').value;
    if (!username || !password) { show('error', 'Enter your username and password.'); return; }

    submit.disabled = true;
    submit.textContent = 'Signing in…';
    notice.hidden = true;
    R.call('login', { username: username, password: password }).then(function (data) {
      R.Session.set(data);
      window.location.replace(data.mustChangePassword ? 'app.html#/account' : 'app.html');
    }).catch(function (err) {
      show('error', err.message || 'Sign-in failed.');
      document.getElementById('password').value = '';
      submit.disabled = false;
      submit.textContent = 'Sign in';
    });
  });
})();
