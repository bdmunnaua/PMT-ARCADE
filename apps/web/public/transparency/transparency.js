// Fills the transparency page from /api/transparency (public, aggregate figures only).
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var pmt = function (units) { return Math.floor(units / 100).toLocaleString('en-US') + ' PMT'; };
  var taka = function (poisha) { return '৳' + (poisha / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }); };
  var whole = function (text) {
    if (text === null || text === undefined) return 'unavailable';
    var n = Number(text);
    return isFinite(n) ? Math.floor(n).toLocaleString('en-US') : text;
  };
  var set = function (id, text) { $(id).textContent = text; };

  function cell(text, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    return td;
  }

  function render(t) {
    set('updated', 'Updated ' + new Date(t.generatedAt).toLocaleString() + ' (refreshes every minute).');
    set('ledger', t.ledgerSum === 0 ? '✓ Balanced (sum = 0)' : '⚠ Out of balance (' + t.ledgerSum + ')');
    set('integrity', t.lastIntegrityCheck ? (t.lastIntegrityCheck.status === 'PASS' ? '✓ PASS' : t.lastIntegrityCheck.status) + ' · ' + new Date(t.lastIntegrityCheck.at).toLocaleDateString() : 'Not run yet');
    set('reserve', taka(t.reserve.reservePoisha));
    set('liability', taka(t.reserve.liabilityPoisha));
    set('coverage', t.reserve.coverageBps === null ? 'Nothing owed' : (t.reserve.coverageBps / 100).toFixed(1) + '%');
    set('rates', 'Buy ' + t.reserve.buyRate.toLocaleString('en-US') + ' · sell-back ' + t.reserve.sellRate.toLocaleString('en-US') + ' PMT per ৳1');
    set('players', t.players.toLocaleString('en-US'));
    set('issued', pmt(t.inApp.issuedUnits));
    set('sellable', pmt(t.inApp.playersSellableUnits));
    set('bonus', pmt(t.inApp.playersBonusUnits));
    set('pool', pmt(t.inApp.rewardsPoolUnits));
    set('fees', pmt(t.inApp.feesUnits));
    set('withdrawn', pmt(t.onchain.withdrawnUnits));
    set('deposited', pmt(t.onchain.depositedUnits));

    var body = $('wallets');
    body.textContent = '';
    t.wallets.forEach(function (w) {
      var tr = document.createElement('tr');
      var name = cell(w.label);
      if (w.purpose) {
        var p = document.createElement('div');
        p.className = 'note';
        p.textContent = w.purpose;
        name.appendChild(p);
      }
      tr.appendChild(name);
      var addr = document.createElement('td');
      var a = document.createElement('a');
      a.className = 'mono';
      a.href = 'https://bscscan.com/token/' + t.token.address + '?a=' + w.address;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = w.address;
      addr.appendChild(a);
      tr.appendChild(addr);
      tr.appendChild(cell(whole(w.balance), 'n'));
      tr.appendChild(cell(w.plannedTokens === null ? '—' : w.plannedTokens.toLocaleString('en-US'), 'n'));
      body.appendChild(tr);
    });
  }

  function load() {
    fetch('/api/transparency', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.success) throw new Error('bad response');
        $('error').textContent = '';
        render(j.data);
      })
      .catch(function () { $('error').textContent = 'Could not load the figures. Try again in a minute.'; });
  }
  load();
  setInterval(load, 60000);
})();
