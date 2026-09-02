(function () {
  var form = document.getElementById('lead');
  if (!form) return;

  var PHONE = '(941) 806-8432';
  var EMAIL = 'alex@axis.deals';

  // Render timestamp - the webhook rejects sub-3-second submits as bots.
  var t = form.querySelector('[name=t]');
  if (t) t.value = String(Date.now());

  // Sell shows the property fields; everything else shows the space fields.
  function sync() {
    var picked = form.querySelector('[name=need]:checked');
    var sell = !!picked && picked.value === 'sell';
    var blocks = form.querySelectorAll('[data-when]');
    for (var i = 0; i < blocks.length; i++) {
      var w = blocks[i].getAttribute('data-when');
      blocks[i].hidden = (w === 'sell') ? !sell : sell;
    }
    var addr = form.querySelector('[name=sell_address]');
    if (addr) addr.required = sell;
  }
  var needs = form.querySelectorAll('[name=need]');
  for (var n = 0; n < needs.length; n++) needs[n].addEventListener('change', sync);
  sync();

  var status = form.querySelector('.status');
  var btn = form.querySelector('button[type=submit]');

  function fail(msg) {
    btn.disabled = false;
    btn.textContent = 'Send it over';
    status.textContent = msg || ("That didn't go through. Call or text me at " + PHONE + ", or email " + EMAIL + ".");
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }

    var fd = new FormData(form);
    fd.append('page', location.href);
    fd.append('ua', navigator.userAgent);

    btn.disabled = true;
    btn.textContent = 'Sending...';
    status.textContent = '';

    // URL-encoded body + Accept header = a CORS "simple request": no preflight to get wrong.
    fetch(form.action, {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      body: new URLSearchParams(fd)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json().catch(function () { return { ok: true }; });
    }).then(function (j) {
      if (j && j.ok === false) { fail(j.message || ''); return; }
      location.href = '/thanks';
    }).catch(function () { fail(); });
  });
})();
