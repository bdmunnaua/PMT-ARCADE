// PMT token pages: "Add to MetaMask", copy buttons and print. No inline scripts (strict CSP).
(function () {
  var TOKEN = {
    address: '0xc576c15Bf0E06AF1a65d15B8219A90f1e07f025F',
    symbol: 'PMT',
    decimals: 18,
    image: 'https://pmtarcade.com/token/pmt-logo-256.png',
  };
  var BSC = {
    chainId: '0x38',
    chainName: 'BNB Smart Chain',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: ['https://bsc-dataseed.binance.org/'],
    blockExplorerUrls: ['https://bscscan.com/'],
  };

  function say(el, text, isError) {
    if (!el) return;
    el.textContent = text;
    el.className = 'msg' + (isError ? ' err' : '');
  }

  async function addToWallet(msg) {
    var eth = window.ethereum;
    if (!eth || !eth.request) {
      say(msg, 'No wallet found in this browser. Open this page in the MetaMask or Trust Wallet app browser, or add the token by hand with the contract address.', true);
      return;
    }
    try {
      var chain = await eth.request({ method: 'eth_chainId' });
      if (chain !== BSC.chainId) {
        try {
          await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BSC.chainId }] });
        } catch (e) {
          if (e && e.code === 4902) await eth.request({ method: 'wallet_addEthereumChain', params: [BSC] });
          else throw e;
        }
      }
      var added = await eth.request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: TOKEN } });
      say(msg, added ? 'PMT was added to your wallet.' : 'Not added.', !added);
    } catch (e) {
      say(msg, e && e.code === 4001 ? 'You cancelled it in the wallet.' : 'The wallet could not add PMT. Add it by hand with the contract address.', true);
    }
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-action]');
    if (!t) return;
    var action = t.getAttribute('data-action');
    if (action === 'add-wallet') {
      ev.preventDefault();
      addToWallet(document.getElementById(t.getAttribute('data-msg') || 'wallet-msg'));
    } else if (action === 'copy') {
      ev.preventDefault();
      var value = t.getAttribute('data-value');
      var done = function () {
        var old = t.textContent;
        t.textContent = 'Copied';
        setTimeout(function () { t.textContent = old; }, 1500);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(value).then(done, function () {});
    } else if (action === 'print') {
      ev.preventDefault();
      window.print();
    }
  });
})();
