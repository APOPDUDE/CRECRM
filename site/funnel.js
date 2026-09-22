/* Shared one-question-at-a-time funnel engine.

   HTML contract:
     <section class="step" data-step="key">            one screen
       .qnum        -> gets "3 of 9" (presence marks it as a numbered question)
       .choices     -> pick-one; add data-multi for pick-many (needs a .next button)
         .choice[data-value][data-score][data-dq][data-next]
       input/textarea/select[name][data-required][data-type=email|phone][data-min=10]
       [data-fields] -> screen holds several named inputs, validated together

   Config: order, branch (key -> fn(state) returning a step key), gate (fn -> bool),
   calendly / form / track (value or fn(state)).

   Everything a visitor does is reported to the funnel-events webhook, including the step
   they quit on — the people who DON'T finish are the ones worth learning from. */
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
    var state = { t: String(Date.now()) };
    var trail = [];
    var cur = order[0];
    var submitted = false;
    var finished = false;
    var score = 0;
    var dq = false;
    var seen = 0;

    var resolve = function (v) { return typeof v === 'function' ? v(state, score, dq) : v; };
    var formOf = function () { return resolve(cfg.form) || 'lead'; };
    var trackOf = function () { return resolve(cfg.track) || null; };

    /* ---- analytics ---- */

    var SID_KEY = 'funnel_sid';
    var sid;
    try {
      sid = sessionStorage.getItem(SID_KEY);
      if (!sid) {
        sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem(SID_KEY, sid);
      }
    } catch (e) {
      sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }

    var queue = [];
    var flushTimer = null;

    function channelOf() {
      var m = location.href.match(/[?&]utm_source=([^&#]+)/);
      if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
      var r = document.referrer || '';
      var h = (r.match(/^https?:\/\/([^/?#]+)/) || [])[1] || '';
      return /instagram/.test(h) ? 'instagram' : /youtu/.test(h) ? 'youtube' : /tiktok/.test(h) ? 'tiktok'
        : /linkedin|lnkd/.test(h) ? 'linkedin' : /facebook|fb\./.test(h) ? 'facebook'
        : /x\.com|twitter/.test(h) ? 'x' : /google/.test(h) ? 'google' : '';
    }

    function record(step, event, value) {
      if (!cfg.events) return;
      queue.push({
        // The client's own clock: events are sent in batches, so insert time would give a
        // whole batch one timestamp and we could no longer tell which screen came last.
        at: new Date().toISOString(),
        session_id: sid, form: formOf(), track: trackOf(), step: step, event: event,
        value: value == null ? '' : String(value).slice(0, 280),
        // How many screens in, not where the step sits in the config array — the array is
        // grouped by track, so its order says nothing about the path a person actually took.
        step_index: seen,
        page: location.href, referrer: document.referrer || '', channel: channelOf(),
      });
      if (queue.length >= 12) return flush();
      if (!flushTimer) flushTimer = setTimeout(flush, 4000);
    }

    function flush(useBeacon) {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (!queue.length || !cfg.events) return;
      var batch = queue.splice(0, queue.length);
      // Form-encoded on purpose: sendBeacon can only make simple requests, so this never
      // triggers a CORS preflight and still lands during page unload.
      var body = new URLSearchParams({ events: JSON.stringify(batch) });
      try {
        if (useBeacon && navigator.sendBeacon) {
          navigator.sendBeacon(cfg.events, new Blob([body.toString()], {
            type: 'application/x-www-form-urlencoded',
          }));
          return;
        }
      } catch (e) { /* fall through to fetch */ }
      try {
        fetch(cfg.events, { method: 'POST', body: body, keepalive: true, mode: 'no-cors' });
      } catch (e) { /* analytics must never break the funnel */ }
    }

    window.addEventListener('pagehide', function () {
      if (!finished) record(cur, 'abandon');
      flush(true);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush(true);
    });

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

    /**
     * Slightly front-loaded: answering question one should feel like real progress without
     * the bar obviously lying to you.
     */
    function eased(p) {
      return Math.round(Math.pow(Math.max(0, Math.min(1, p)), 0.8) * 100);
    }

    function show(key) {
      cur = key;
      seen += 1;
      rescore();
      order.forEach(function (k) { if (steps[k]) steps[k].hidden = k !== key; });
      var qs = questionPath();
      var at = qs.indexOf(key);
      var num = steps[key].querySelector('.qnum');
      if (num && at >= 0) num.textContent = (at + 1) + ' of ' + qs.length;
      if (bar) {
        var pct = (key === 'book' || key === 'done' || key === 'notyet') ? 100
          : at < 0 ? 0
          : eased((at + 1) / (qs.length + 1));
        bar.style.width = pct + '%';
      }
      if (back) back.hidden = !trail.length || key === 'done' || key === 'notyet';
      if (cfg.onStep) cfg.onStep(key, state, score, dq);
      startTyping(steps[key]);
      var field = steps[key].querySelector('input, textarea, select');
      if (field) setTimeout(function () { field.focus(); }, 60);
      record(key, 'view');
      if (key === 'book') book();
      if (key === 'notyet') { finished = true; submit().catch(function () {}); }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }


    /* ---- typed placeholders ---- */

    // A field can carry data-typed="one|two|three" and the examples get typed into its
    // placeholder, held long enough to read, deleted, and replaced. Stops the moment the
    // visitor touches the field, and never runs for anyone who asked for less motion.
    var typing = null;

    function stopTyping() {
      if (!typing) return;
      clearTimeout(typing.timer);
      if (typing.el) typing.el.placeholder = typing.rest || '';
      typing = null;
    }

    function startTyping(stepEl) {
      stopTyping();
      var el = stepEl.querySelector('[data-typed]');
      if (!el) return;
      var rest = el.getAttribute('data-placeholder-idle') || '';
      try {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          el.placeholder = (el.getAttribute('data-typed') || '').split('|')[0] || rest;
          return;
        }
      } catch (e) {}
      var lines = (el.getAttribute('data-typed') || '').split('|').filter(Boolean);
      if (!lines.length) return;

      typing = { el: el, rest: rest, timer: null };
      var i = 0, pos = 0, erasing = false;

      function tick() {
        if (!typing || typing.el !== el) return;
        var line = lines[i];
        if (!erasing) {
          pos += 1;
          el.placeholder = line.slice(0, pos);
          if (pos >= line.length) {
            erasing = true;
            typing.timer = setTimeout(tick, 2600); // long enough to actually read it
            return;
          }
          typing.timer = setTimeout(tick, 34);
          return;
        }
        pos -= 1;
        el.placeholder = line.slice(0, pos);
        if (pos <= 0) {
          erasing = false;
          i = (i + 1) % lines.length;
          typing.timer = setTimeout(tick, 420);
          return;
        }
        typing.timer = setTimeout(tick, 16);
      }

      ['focus', 'input', 'keydown'].forEach(function (ev) {
        el.addEventListener(ev, stopTyping, { once: true });
      });
      typing.timer = setTimeout(tick, 500);
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
        return Array.prototype.map.call(group.querySelectorAll('.choice.picked'), function (b) {
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
      if (!s.querySelector('.choices, input, textarea, select')) return;
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
        if (!steps[k]) return;
        Array.prototype.forEach.call(steps[k].querySelectorAll('.choice.picked'), function (b) {
          score += parseInt(b.getAttribute('data-score') || '0', 10);
          if (b.hasAttribute('data-dq')) dq = true;
        });
      });
    }

    /* ---- moving ---- */

    function next() {
      if (!validate(cur)) return;
      capture(cur);
      rescore();
      var k = nextKeyOf(cur);
      if (!k) return;
      record(cur, 'next', steps[cur].querySelector('.choices') ? state[cur] : '(answered)');
      trail.push(cur);
      show(k);
    }

    document.querySelectorAll('.choices').forEach(function (group) {
      var many = group.hasAttribute('data-multi');
      group.querySelectorAll('.choice').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var v = btn.getAttribute('data-value');
          var stepKey = btn.closest('.step').getAttribute('data-step');
          if (many) {
            if (btn.hasAttribute('data-solo')) {
              group.querySelectorAll('.choice').forEach(function (b) { b.classList.remove('picked'); });
            } else {
              group.querySelectorAll('.choice[data-solo]').forEach(function (b) { b.classList.remove('picked'); });
            }
            btn.classList.toggle('picked');
            rescore();
            record(stepKey, 'choice', v);
            return;
          }
          group.querySelectorAll('.choice').forEach(function (b) { b.classList.remove('picked'); });
          btn.classList.add('picked');
          record(stepKey, 'choice', v);
          if (cfg.onChoice) cfg.onChoice(stepKey, v, state);
          setTimeout(next, 140);
        });
      });
    });

    document.querySelectorAll('.next').forEach(function (b) { b.addEventListener('click', next); });
    document.querySelectorAll('.skip').forEach(function (b) {
      b.addEventListener('click', function () {
        state[cur] = '';
        var k = nextKeyOf(cur);
        if (k) { record(cur, 'next', '(skipped)'); trail.push(cur); show(k); }
      });
    });
    if (back) {
      back.addEventListener('click', function () {
        var k = trail.pop();
        if (k) { record(cur, 'back'); show(k); }
      });
    }

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
      data.append('form', formOf());
      if (cfg.gate && (!cfg.scoreWhen || cfg.scoreWhen(state, score, dq))) {
        data.append('qualified', cfg.gate(state, score, dq) ? '1' : '0');
      }
      data.append('score', String(score));
      // Whatever the page derived from the answers (the price tier, say) rather than asked for.
      var ex = resolve(cfg.extra) || {};
      Object.keys(ex).forEach(function (k) {
        data.append(k, ex[k] == null ? '' : String(ex[k]));
      });
      // The only thing tying these answers to the booking that follows: there is no contact
      // screen any more, so the Calendly invitee carries this id back in utm_content.
      data.append('session_id', sid);
      data.append('page', location.href);
      data.append('ref', document.referrer || '');
      data.append('ua', navigator.userAgent);
      data.append('company_website', '');
      record(cur, 'submit');
      flush();
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
          name: state.name || '', email: state.email || '', phone: state.phone || '',
        }));
      } catch (e) {}
      var url = resolve(cfg.calendly);
      var link = document.getElementById('cal-link');
      if (link) link.href = url + '?utm_content=' + encodeURIComponent(sid);
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
          // utm_content is how the paid booking finds the answers this person just gave.
          url: url + '?hide_gdpr_banner=1&utm_content=' + encodeURIComponent(sid),
          parentElement: document.getElementById('calendly'),
          prefill: { name: state.name || '', email: state.email || '' },
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
        session_id: sid, form: formOf(),
      });
      try { fetch(cfg.booked, { method: 'POST', body: body, keepalive: true }); } catch (err) {}
      finished = true;
      record('book', 'book');
      flush();
      show('done');
    });

    show(order[0]);

    // A small handle so a screen can steer the flow itself — the not-yet screen uses it to
    // let someone buy the advisory hour instead of being turned away with a link list.
    return {
      go: show,
      set: function (k, v) { state[k] = v; },
      state: state,
    };
  };
})(window, document);
