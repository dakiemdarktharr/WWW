const [major, minor, patch] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && (minor < 22 || (minor === 22 && patch < 1)))) {
  throw new Error(
    'RELAY requires Node.js 24.22.1 or newer. Upgrade Node, or use start-relay.cmd / the isolated-runtime commands in README.md.',
  );
}
