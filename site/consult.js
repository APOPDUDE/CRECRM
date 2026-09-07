(function () {
  var ORDER = ['intro', 'need', 'details', 'area', 'budget', 'timing', 'name', 'company', 'email', 'phone', 'book', 'done'];
  var QUESTIONS = ORDER.slice(1, 10); // the numbered ones
  var WEBHOOK = 'https://n8n.ayxco.com/webhook/alexpoplawski-lead';
  var CALENDLY = 'https://calendly.com/alex-axis/consultation';
  var PHONE = '(941) 806-8432';
  var steps = {};
  ORDER.forEach(function (k) { steps[k] = document.querySelector('.step[data-step="' + k + '"]'); });
  var bar = document.getElementById('bar');
  var back = document.getElementById('back');
  var state = { t: String(Date.now()), form: 'consultation' };
  var cur = 0;
  var submitted = false;

  function show(i) {
    cur = i;
    var key = ORDER[i];
    ORDER.forEach(function (k) { steps[k].hidden = k !== key; });
    var q = QUESTIONS.indexOf(key);
    var num = steps[key].querySelector('.qnum');
    if (num) num.textContent = (q + 1) + ' of ' + QUESTIONS.length;
    bar.style.width = (key === 'intro' ? 0 : key === 'book' || key === 'done' ? 100 : Math.round(((q + 1) / (QUESTIONS.length + 1)) * 100)) + '%';
    back.hidden = i === 0 || key === 'done';
    var field = steps[key].querySelector('input, textarea');
    if (field) setTimeout(function () { field.focus(); }, 60);
    if (key === 'book') book();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function value(key) {
    var s = steps[key];
    var picked = s.querySelector('.choice.picked');
    if (picked) return picked.getAttribute('data-value');
    var f = s.querySelector('input, textarea');
    return f ? f.value.trim() : '';
  }

  function validate(key) {
    var s = steps[key];
    var err = s.querySelector('.err');
    var v = value(key);
    var msg = '';
    if (key === 'details' && v.length < 10) msg = 'A sentence or two is enough, but give Alex something to work with.';
    if (key === 'name' && !v) msg = 'Your name, please.';
    if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = 'That email doesn\'t look right.';
    if (key === 'phone' && v.replace(/\D/g, '').replace(/^1/, '').length !== 10) msg = 'A 10-digit number, please.';
    if (err) err.textContent = msg;
    return !msg;
  }

  function next() {
    var key = ORDER[cur];
    if (key !== 'intro' && !validate(key)) return;
    if (key !== 'intro') state[key] = value(key);
    if (cur < ORDER.length - 1) show(cur + 1);
  }

  // Chips: pick one and move on.
  document.querySelectorAll('.choices').forEach(function (group) {
    group.querySelectorAll('.choice').forEach(function (btn) {
      btn.addEventListener('click', function () {
        group.querySelectorAll('.choice').forEach(function (b) { b.classList.remove('picked'); });
        btn.classList.add('picked');
        setTimeout(next, 140);
      });
    });
  });
  document.querySelectorAll('.next').forEach(function (b) { b.addEventListener('click', next); });
  document.querySelectorAll('.skip').forEach(function (b) {
    b.addEventListener('click', function () { state[ORDER[cur]] = ''; show(cur + 1); });
  });
  back.addEventListener('click', function () { if (cur > 0) show(cur - 1); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var key = ORDER[cur];
    if (key === 'book' || key === 'done') return;
    if (e.target && e.target.tagName === 'TEXTAREA' && !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    next();
  });

  function submit() {
    if (submitted) return Promise.resolve();
    var data = new URLSearchParams();
    Object.keys(state).forEach(function (k) { data.append(k, state[k] == null ? '' : state[k]); });
    data.append('page', location.href);
    data.append('ref', document.referrer || '');
    data.append('ua', navigator.userAgent);
    data.append('company_website', '');
    return fetch(WEBHOOK, { method: 'POST', headers: { 'Accept': 'application/json' }, body: data })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json().catch(function () { return { ok: true }; }); })
      .then(function (j) { if (j && j.ok === false) throw new Error(j.message || 'rejected'); submitted = true; });
  }

  function book() {
    var status = steps.book.querySelector('.status');
    submit().catch(function () {
      status.textContent = 'Your answers didn\'t save, but you can still book below. Or call ' + PHONE + '.';
    });
    try { sessionStorage.setItem('lead', JSON.stringify({ name: state.name || '', email: state.email || '', phone: state.phone || '' })); } catch (e) {}
    if (window.Calendly) return init();
    var s = document.createElement('script');
    s.src = 'https://assets.calendly.com/assets/external/widget.js';
    s.async = true;
    s.onload = init;
    document.head.appendChild(s);
    function init() {
      if (steps.book.getAttribute('data-inited')) return;
      steps.book.setAttribute('data-inited', '1');
      window.Calendly.initInlineWidget({
        url: CALENDLY + '?hide_gdpr_banner=1',
        parentElement: document.getElementById('calendly'),
        prefill: { name: state.name || '', email: state.email || '' }
      });
    }
  }

  // A completed booking: tell the CRM, then show the done screen.
  window.addEventListener('message', function (e) {
    if (!e.origin || e.origin.indexOf('calendly.com') === -1) return;
    var d = e.data; if (!d || d.event !== 'calendly.event_scheduled') return;
    var p = d.payload || {};
    var body = new URLSearchParams({
      invitee_uri: (p.invitee && p.invitee.uri) || '', event_uri: (p.event && p.event.uri) || '',
      name: state.name || '', email: state.email || '', phone: state.phone || ''
    });
    try { fetch('https://n8n.ayxco.com/webhook/alexpoplawski-booked', { method: 'POST', body: body, keepalive: true }); } catch (err) {}
    show(ORDER.indexOf('done'));
  });

  show(0);
})();
