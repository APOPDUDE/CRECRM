/* Shared one-question-at-a-time funnel engine.
   Drives /consultation and /crm from the same code.

   HTML contract:
     <section class="step" data-step="key">            one screen
       .qnum        -> gets "3 of 9" (presence marks it as a numbered question)
       .choices     -> pick-one; add data-multi for pick-many (needs a .next button)
         .choice[data-value][data-score][data-dq][data-next]
       input/textarea[name][data-required][data-type=email|phone][data-min=10]
       [data-fields] -> screen holds several named inputs, all validated together
     Config: order, branch (key -> fn(state) returning a step key), gate (fn -> bool). */
(function (window, document) {
  'use strict';

  window.initFunnel = function (cfg) {
    var order = cfg.order;
    var steps = {};
    order.forEach(function (k) {
      steps[k] = document.querySelector('.step[data-step="' + k + '"]');
    });
    var bar = document.getElementById('bar');
    var back = document.getElementById('back');
    var state = { t: String(Date.now()), form: cfg.form };
    var trail = [];
    var cur = order[0];
    var submitted = false;
    var score = 0;
    var dq = false;

    /* ---- flow ---- */

    function nextKeyOf(key, st) {
      var branched = cfg.branch && cfg.branch[key] && cfg.branch[key](st || state);
      var k = branched || null;
      if (!k) {
        var picked = steps[key] && steps[key].querySelector('.choice.picked[data-next]');
        if (picked) k = picked.getAttribute('data-next');
      }
      if (!k) {
        var i = order.indexOf(key);
        k = i >= 0 && i < order.length - 1 ? order[i + 1] : null;
      }
      if (k === 'book' && cfg.gate && !cfg.gate(state, score, dq)) return 'notyet';
      return k;
    }

    function pathFrom(key) {
      var path = [], k = key, guard = 0;
      while (k && guard++ < 60) { path.push(k); k = nextKeyOf(k); }
      return path;
    }

    function questionPath() {
      return pathFrom(order[0]).filter(function (k) {
        return steps[k] && steps[k].querySelector('.qnum');
      });
    }

    function show(key) {
      cur = key;
      order.forEach(function (k) { if (steps[k]) steps[k].hidden = k !== key; });
      var qs = questionPath();
      var at = qs.indexOf(key);
      var num = steps[key].querySelector('.qnum');
      if (num && at >= 0) num.textContent = (at + 1) + ' of ' + qs.length;
      if (bar) {
        var pct = key === order[0] ? 0
          : (key === 'book' || key === 'done' || key === 'notyet') ? 100
          : Math.round(((at + 1) / (qs.length + 1)) * 100);
        bar.style.width = pct + '%';
      }
      if (back) back.hidden = !trail.length || key === 'done' || key === 'notyet';
      var field = steps[key].querySelector('input, textarea');
      if (field) setTimeout(function () { field.focus(); }, 60);
      if (key === 'book') book();
      if (key === 'notyet') submit().catch(function () {});
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ---- values ---- */

    function fieldsOf(key) {
      return Array.prototype.slice.call(
        steps[key].querySelectorAll('input[name], textarea[name], select[name]'));
    }

    function value(key) {
      var s = steps[key];
      var group = s.querySelector('.choices');
      if (group) {
        var picked = group.querySelectorAll('.choice.picked');
        return Array.prototype.map.call(picked, function (b) {
          return b.getAttribute('data-value');
        }).join(',');
      }
      var f = s.querySelector('input, textarea, select');
      return f ? String(f.value).trim() : '';
    }

    function capture(key) {
      var s = steps[key];
      if (s.hasAttribute('data-fields')) {
        fieldsOf(key).forEach(function (f) { state[f.name] = String(f.value).trim(); });
        return;
      }
      state[key] = value(key);
    }

    /* ---- validation ---- */

    function problem(f) {
      var v = String(f.value).trim();
      var type = f.getAttribute('data-type');
      var min = parseInt(f.getAttribute('data-min') || '0', 10);
      if (f.hasAttribute('data-required') && !v) return f.getAttribute('data-msg') || 'This one is required.';
      if (!v) return '';
      if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'That email does not look right.';
      if (type === 'phone' && v.replace(/\D/g, '').replace(/^1/, '').length !== 10) return 'A 10-digit number, please.';
      if (min && v.length < min) return f.getAttribute('data-msg') || 'A sentence is enough.';
      return '';
    }

    function validate(key) {
      var s = steps[key];
      var err = s.querySelector('.err');
      var msg = '';
      var group = s.querySelector('.choices');
      if (group && group.hasAttribute('data-required') && !group.querySelector('.choice.picked')) {
        msg = 'Pick at least one.';
      }
      if (!msg) {
        var fs = fieldsOf(key);
        for (var i = 0; i < fs.length; i++) {
          msg = problem(fs[i]);
          if (msg) break;
        }
      }
      if (err) err.textContent = msg;
      return !msg;
    }

    /* ---- scoring ---- */

    function rescore() {
      score = 0;
      dq = false;
      order.forEach(function (k) {
        if (!steps[k] || steps[k].hidden === undefined) return;
        var picked = steps[k].querySelectorAll('.choice.picked');
        Array.prototype.forEach.call(picked, function (b) {
          score += parseInt(b.getAttribute('data-score') || '0', 10);
          if (b.hasAttribute('data-dq')) dq = true;
        });
      });
      if (cfg.adjust) score = cfg.adjust(state, score);
    }

    /* ---- moving ---- */

    function next() {
      if (cur !== order[0] && !validate(cur)) return;
      if (cur !== order[0]) capture(cur);
      rescore();
      var k = nextKeyOf(cur);
      if (!k) return;
      trail.push(cur);
      show(k);
    }

    function goBack() {
      var k = trail.pop();
      if (k) show(k);
    }

    document.querySelectorAll('.choices').forEach(function (group) {
      var many = group.hasAttribute('data-multi');
      group.querySelectorAll('.choice').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (many) {
            var solo = btn.hasAttribute('data-solo');
            if (solo) {
              group.querySelectorAll('.choice').forEach(function (b) { b.classList.remove('picked'); });
            } else {
              group.querySelectorAll('.choice[data-solo]').forEach(function (b) { b.classList.remove('picked'); });
            }
            btn.classList.toggle('picked');
            rescore();
            return;
          }
          group.querySelectorAll('.choice').forEach(function (b) { b.classList.remove('picked'); });
          btn.classList.add('picked');
          setTimeout(next, 140);
        });
      });
    });

    document.querySelectorAll('.next').forEach(function (b) { b.addEventListener('click', next); });
    document.querySelectorAll('.skip').forEach(function (b) {
      b.addEventListener('click', function () {
        state[cur] = '';
        var k = nextKeyOf(cur);
        if (k) { trail.push(cur); show(k); }
      });
    });
    if (back) back.addEventListener('click', goBack);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (cur === 'book' || cur === 'done' || cur === 'notyet') return;
      if (e.target && e.target.tagName === 'TEXTAREA' && !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      next();
    });

    /* ---- submit ---- */

    function submit() {
      if (submitted) return Promise.resolve();
      rescore();
      var data = new URLSearchParams();
      Object.keys(state).forEach(function (k) {
        data.append(k, state[k] == null ? '' : state[k]);
      });
      if (cfg.gate) {
        data.append('qualified', cfg.gate(state, score, dq) ? '1' : '0');
        data.append('score', String(score));
      }
      data.append('page', location.href);
      data.append('ref', document.referrer || '');
      data.append('ua', navigator.userAgent);
      data.append('company_website', '');
      return fetch(cfg.webhook, { method: 'POST', headers: { Accept: 'application/json' }, body: data })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json().catch(function () { return { ok: true }; }); })
        .then(function (j) { if (j && j.ok === false) throw new Error(j.message || 'rejected'); submitted = true; });
    }

    /* ---- booking ---- */

    function book() {
      var status = steps.book.querySelector('.status');
      submit().catch(function () {
        if (status) status.textContent = 'Your answers did not save, but you can still book below. Or call ' + (cfg.phone || '');
      });
      try {
        sessionStorage.setItem('lead', JSON.stringify({
          name: state.name || '', email: state.email || '', phone: state.phone || ''
        }));
      } catch (e) {}
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
          url: cfg.calendly + '?hide_gdpr_banner=1',
          parentElement: document.getElementById('calendly'),
          prefill: { name: state.name || '', email: state.email || '' }
        });
      }
    }

    window.addEventListener('message', function (e) {
      if (!e.origin || e.origin.indexOf('calendly.com') === -1) return;
      var d = e.data;
      if (!d || d.event !== 'calendly.event_scheduled') return;
      var p = d.payload || {};
      var body = new URLSearchParams({
        invitee_uri: (p.invitee && p.invitee.uri) || '',
        event_uri: (p.event && p.event.uri) || '',
        name: state.name || '', email: state.email || '', phone: state.phone || '',
        form: cfg.form
      });
      try { fetch(cfg.booked, { method: 'POST', body: body, keepalive: true }); } catch (err) {}
      show('done');
    });

    show(order[0]);
  };
})(window, document);
