import { useState } from 'react';
import { ArrowUpRight, Check, Copy, Link2, Unplug } from 'lucide-react';
import { hostedOrigin, runnerOrigin } from '../shared/browser-bridge';
import { connectBridge, disconnectBridge } from './bridge';
import './hosted.css';

const repository = 'https://github.com/dakiemdarktharr/WWW';
const commands = `git clone ${repository}.git\ncd WWW\nnpm ci\nnpm run build\nnpm start`;

export default function RunnerConnection({
  status,
  message,
}: {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  message: string;
}) {
  const [port, setPort] = useState('4317');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  let valid = true;
  try {
    runnerOrigin(port);
  } catch {
    valid = false;
  }
  const connected = status === 'connected';
  return (
    <section className="runner-connection panel" aria-labelledby="runner-heading">
      <div className="panel-heading">
        <h2 id="runner-heading">
          <Link2 size={17} /> Runner
        </h2>
        <span
          className={`presence ${connected ? 'ready' : ''}`}
          aria-label={connected ? 'Connected' : 'Disconnected'}
        />
      </div>
      <div className="runner-body">
        <p>
          {connected
            ? 'Đã kết nối Codex thật. MESH, Sessions và Team thao tác trực tiếp với runner này.'
            : 'MESH và Sessions mở ngay trên web. Kết nối runner để dùng tài khoản Codex và dữ liệu dự án trên máy của bạn.'}
        </p>
        {!connected && (
          <details>
            <summary>Cài đặt runner lần đầu</summary>
            <p>Node 24.22.1+ · Git · Codex CLI · quyền truy cập repo private</p>
            <div className="runner-command" data-usage="setup">
              <pre>
                <code>{commands}</code>
              </pre>
              <button
                className="icon-button"
                aria-label="Copy setup commands"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(commands);
                    setCopied(true);
                    setCopyError(false);
                  } catch {
                    setCopyError(true);
                  }
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            {copyError && <p role="status">Chọn các lệnh trên để sao chép.</p>}
            <p>
              Giữ <code>npm start</code> chạy trên cùng máy đang mở trình duyệt.
            </p>
            <a href={repository} target="_blank" rel="noopener noreferrer">
              Private repository <ArrowUpRight size={13} />
            </a>
          </details>
        )}
        {window.location.origin !== hostedOrigin && (
          <p>
            Để kết nối, mở{' '}
            <a href={`${hostedOrigin}/${window.location.hash}`}>nosleepclub-relay.vercel.app</a>.
          </p>
        )}
        <div className="runner-buttons" data-usage="runner-connect">
          {!connected && (
            <label htmlFor="runner-port">
              Port{' '}
              <input
                id="runner-port"
                data-usage="port"
                inputMode="numeric"
                value={port}
                onChange={(event) => setPort(event.target.value)}
                aria-invalid={!valid}
                maxLength={5}
                disabled={status === 'connecting'}
              />
            </label>
          )}
          {connected || status === 'connecting' ? (
            <button className="button" onClick={() => disconnectBridge()}>
              <Unplug size={15} /> {connected ? 'Ngắt kết nối' : 'Hủy kết nối'}
            </button>
          ) : (
            <button
              className="button primary"
              disabled={!valid}
              onClick={() => connectBridge(port)}
            >
              <Link2 size={15} /> Kết nối runner
            </button>
          )}
        </div>
        {message && <p role={status === 'error' ? 'alert' : 'status'}>{message}</p>}
        {!connected && (
          <p className="runner-hint">
            Cho phép popup, xác nhận kết nối rồi giữ cửa sổ runner mở. Web không tự khởi động Codex
            khi bạn chưa đăng nhập và gửi prompt.
          </p>
        )}
      </div>
    </section>
  );
}
