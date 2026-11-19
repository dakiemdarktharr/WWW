import { formatEther, toQuantity } from 'ethers';
import { CHAIN, ISSUER, EXPLORER, grantDigest, publicRpc, verifyFuji } from '../shared/fuji-qr.mjs';

const el = (id) => document.getElementById(id);
const show = (message) => {
  el('status').textContent = message;
};
const chainHex = toQuantity(CHAIN);
const self = ISSUER.toLowerCase();
const local = location.hostname === '127.0.0.1' && location.protocol === 'http:';
let core = window.avalanche;
let doc, digest, key;
window.addEventListener('eip6963:announceProvider', ({ detail }) => {
  if (
    !core &&
    (detail.info?.rdns === 'app.core' || /^core( wallet)?$/i.test(detail.info?.name || ''))
  )
    core = detail.provider;
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
let locked = false;
function link(hash) {
  el('explorer').href = EXPLORER + hash;
  el('explorer').textContent = 'Xem giao dịch ' + hash;
  el('explorer').hidden = false;
}
async function confirmed(hash) {
  const result = await verifyFuji(doc.grant, hash, publicRpc);
  if (
    doc.transaction &&
    (doc.transaction.hash !== hash ||
      result.blockHash !== doc.transaction.blockHash ||
      result.blockNumber !== doc.transaction.blockNumber)
  )
    throw new Error('Bản ghi trên Fuji khác với biên nhận đã công bố.');
  link(hash);
  show(
    'Đã xác minh mã cam kết cho gói ' +
      doc.grant.plan.toUpperCase() +
      ' tại block ' +
      result.blockNumber +
      '.',
  );
  el('operator').hidden = true;
}
async function preflight() {
  if (!core) throw new Error('Mở trang trong Edge với tiện ích Core đã bật.');
  const network = await core.request({ method: 'eth_chainId' });
  if (BigInt(network) !== BigInt(CHAIN))
    throw new Error('Chọn Avalanche Fuji C-Chain (43113) trong Core rồi kết nối lại.');
  const accounts = await core.request({ method: 'eth_accounts' });
  if (accounts[0]?.toLowerCase() !== self)
    throw new Error('Chọn tài khoản Core có địa chỉ ' + ISSUER + '.');
  if (BigInt(await publicRpc('eth_chainId', [])) !== BigInt(CHAIN))
    throw new Error('RPC không trả về mạng Fuji.');
  if ((await publicRpc('eth_getCode', [ISSUER, 'latest'])) !== '0x')
    throw new Error('Ví nhận phải là tài khoản thường.');
  const call = { from: ISSUER, to: ISSUER, value: '0x0', data: digest };
  const [estimate, price, balance] = await Promise.all([
    publicRpc('eth_estimateGas', [call]),
    publicRpc('eth_gasPrice', []),
    publicRpc('eth_getBalance', [ISSUER, 'latest']),
  ]);
  const gas = (BigInt(estimate) * 11n) / 10n + 1n,
    gasPrice = BigInt(price) * 2n + 1n,
    maxCost = gas * gasPrice;
  if (maxCost > 1000000000000000n || maxCost > BigInt(balance))
    throw new Error('Phí vượt trần 0,001 test AVAX hoặc số dư khả dụng.');
  el('fee').textContent = formatEther(maxCost) + ' test AVAX';
  return { ...call, chainId: chainHex, gas: toQuantity(gas), gasPrice: toQuantity(gasPrice) };
}
el('connect').onclick = async () => {
  try {
    el('sign').disabled = true;
    if (!local || !core) throw new Error('Dùng Edge trên máy chạy demo với tiện ích Core đã bật.');
    await core.request({ method: 'eth_requestAccounts' });
    if (BigInt(await core.request({ method: 'eth_chainId' })) !== BigInt(CHAIN))
      await core.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] });
    await preflight();
    if (localStorage.getItem(key))
      throw new Error('Đã có yêu cầu ký. Kiểm tra Core hoặc lịch sử Fuji trước khi tiếp tục.');
    el('sign').disabled = false;
    show('Đúng ví phát hành và mạng Fuji. Có thể mở giao dịch để ký.');
  } catch (error) {
    show(error.message);
  }
};
el('sign').onclick = async () => {
  if (!local || locked || !key || !navigator.locks) return;
  el('sign').disabled = true;
  locked = true;
  try {
    await navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
      if (!lock || localStorage.getItem(key))
        throw new Error('Đã có yêu cầu ký cho biên nhận này.');
      const tx = await preflight();
      const nonce = await publicRpc('eth_getTransactionCount', [ISSUER, 'pending']);
      localStorage.setItem(key, JSON.stringify({ nonce }));
      show('Đang chờ bạn duyệt trong Core.');
      let hash;
      try {
        hash = await core.request({ method: 'eth_sendTransaction', params: [{ ...tx, nonce }] });
      } catch (error) {
        if (error.code === 4001) {
          localStorage.removeItem(key);
          el('sign').disabled = false;
        }
        throw error;
      }
      if (!/^0x[0-9a-f]{64}$/.test(hash))
        throw new Error('Kiểm tra lịch sử ví để tìm giao dịch đã ký.');
      localStorage.setItem(key, JSON.stringify({ nonce, hash }));
      link(hash);
      show('Đã gửi lên Fuji. Đang chờ xác nhận.');
      for (let i = 0; i < 30; i++) {
        if (await publicRpc('eth_getTransactionReceipt', [hash])) {
          await confirmed(hash);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      show('Đã gửi giao dịch. Mở Explorer hoặc tải lại trang để kiểm tra xác nhận.');
    });
  } catch (error) {
    show(error.message);
  } finally {
    locked = false;
  }
};
async function main() {
  const response = await fetch('/kivuno-qr-fuji.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Chưa có biên nhận công khai được chọn.');
  doc = await response.json();
  digest = grantDigest(doc.grant);
  key = 'kivuno.qr.fuji.attempt.' + digest;
  if (doc.commitment !== digest) throw new Error('Mã cam kết không khớp dữ liệu gói.');
  el('plan').textContent = doc.grant.plan.toUpperCase();
  el('start').textContent = new Date(doc.grant.grantedAt).toLocaleString('vi-VN');
  el('end').textContent = new Date(doc.grant.paidUntil).toLocaleString('vi-VN');
  el('issuer').textContent = ISSUER;
  el('digest').textContent = digest;
  if (doc.transaction) {
    await confirmed(doc.transaction.hash);
    return;
  }
  const prior = JSON.parse(localStorage.getItem(key) || 'null');
  if (prior?.hash) {
    link(prior.hash);
    await confirmed(prior.hash);
    return;
  }
  if (prior) {
    show('Một yêu cầu đã mở trong Core. Kiểm tra lịch sử ví để tìm hash và tránh gửi lần hai.');
    return;
  }
  el('operator').hidden = !local;
  show(local ? 'Kết nối Core bằng ví phát hành để ký trên Fuji.' : 'Chờ công bố giao dịch Fuji.');
}
main().catch((error) => show(error.message));
